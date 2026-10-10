# Prototipo "estilo Minecraft": forma de cubos grandes (B×B×B) + la textura pintada en la capa de afuera
import json, sys
import numpy as np
from collections import Counter, deque
from scipy.spatial import cKDTree
from PIL import Image
from load import load, GOGETA
TARGET=int(sys.argv[1]) if len(sys.argv)>1 else 32   # alto final (cubos)
B=int(sys.argv[2]) if len(sys.argv)>2 else 3          # tamaño del cubo grande
FILLMIN=float(sys.argv[3]) if len(sys.argv)>3 else 0.4  # qué tanto debe llenarse un cubo grande para existir
NCOL=int(sys.argv[4]) if len(sys.argv)>4 else 24
OUT=sys.argv[5] if len(sys.argv)>5 else 'gogeta-mine.json'
SKIP={0}
objs,mats=load(GOGETA)
rng=np.random.default_rng(4)
pts=[];cols=[]
for V,F in objs:
    for mat,part,vs in F:
        if mat in SKIP: continue
        tex=mats[mat][1]; idx=[i for i,_,_ in vs]; uv=np.array([(u,v) for _,u,v in vs])
        for t in range(1,len(vs)-1):
            tri=[0,t,t+1]; P=V[[idx[j] for j in tri]]; UV=uv[tri]
            area=np.linalg.norm(np.cross(P[1]-P[0],P[2]-P[0]))/2
            n=max(6,int(area*5000))
            r=rng.random((n,2)); m=r.sum(1)>1; r[m]=1-r[m]; w=np.c_[1-r.sum(1),r]
            p=w@P; q=w@UV; h,wd,_=tex.shape
            pts.append(p); cols.append(tex[np.clip((q[:,1]%1*h).astype(int),0,h-1),np.clip((q[:,0]%1*wd).astype(int),0,wd-1)])
pts=np.vstack(pts); cols=np.vstack(cols).astype(float)
mn=pts.min(0); mx=pts.max(0)
s=(TARGET-0.01)/(mx-mn).max()
G=(pts-mn)*s
# 1) volumen fino (relleno)
g=np.floor(G).astype(int); dims=g.max(0)+1
solid=np.zeros(dims+2,bool)
solid[g[:,0]+1,g[:,1]+1,g[:,2]+1]=True
out=np.zeros_like(solid); out[0,0,0]=True; dq=deque([(0,0,0)])
for_n=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
while dq:
    x,y,z=dq.popleft()
    for dx,dy,dz in for_n:
        a,b,c=x+dx,y+dy,z+dz
        if 0<=a<solid.shape[0] and 0<=b<solid.shape[1] and 0<=c<solid.shape[2] and not out[a,b,c] and not solid[a,b,c]:
            out[a,b,c]=True; dq.append((a,b,c))
fine=~out[1:-1,1:-1,1:-1]
# 2) forma de cubos grandes: un cubo grande existe si su bloque B×B×B está lleno al menos FILLMIN
cd=-(-dims//B)
pad=np.zeros(cd*B,bool); pad[:dims[0],:dims[1],:dims[2]]=fine
frac=pad.reshape(cd[0],B,cd[1],B,cd[2],B).mean((1,3,5))
coarse=frac>=FILLMIN
occ=np.repeat(np.repeat(np.repeat(coarse,B,0),B,1),B,2)
cells=[tuple(c) for c in np.argwhere(occ)]
occset=set(cells)
# 3) la capa de afuera toma el color de la superficie más cercana; lo de adentro, un solo tono
def outer(c):
    x,y,z=c
    return any((x+dx,y+dy,z+dz) not in occset for dx,dy,dz in for_n)
surf=[c for c in cells if outer(c)]
tree=cKDTree(G)
_,ix=tree.query(np.array(surf,float)+0.5,k=12)
sc_=[]
for row in ix:
    c=cols[row]; b=(c//24).astype(int); top=Counter(map(tuple,b)).most_common(1)[0][0]
    sc_.append(c[(b==top).all(1)].mean(0))
if NCOL<=1: colmap={c:'#ece6dc' for c in surf}
else:
    img=Image.new('RGB',(len(surf),1)); img.putdata([tuple(int(v) for v in c) for c in sc_])
    q=img.quantize(colors=NCOL,method=Image.Quantize.MEDIANCUT); pal=q.getpalette()
    colmap={c:'#%02x%02x%02x'%tuple(pal[i*3:i*3+3]) for c,i in zip(surf,q.getdata())}
INSIDE='#7a2a2a'
for c in cells:
    if c not in colmap: colmap[c]=INSIDE
# 4) juntar: el relleno en cajas grandes, la capa de afuera por color
ks=cells
def merge(order):
    done=set(); res=[]
    for k in sorted(ks,key=lambda c:(c[order[2]],c[order[1]],c[order[0]])):
        if k in done: continue
        col=colmap[k]; lo=list(k); hi=list(k)
        ok=lambda c: c in colmap and c not in done and colmap[c]==col
        def can(axis):
            r=[range(lo[i],hi[i]+1) for i in range(3)]; r[axis]=[hi[axis]+1]
            return all(ok((x,y,z)) for x in r[0] for y in r[1] for z in r[2])
        for axis in order:
            while can(axis): hi[axis]+=1
        for x in range(lo[0],hi[0]+1):
            for y in range(lo[1],hi[1]+1):
                for z in range(lo[2],hi[2]+1): done.add((x,y,z))
        res.append((tuple(lo),tuple(hi[i]-lo[i]+1 for i in range(3)),col))
    return res
boxes=min((merge(o) for o in [(0,2,1),(2,0,1),(1,0,2),(0,1,2)]),key=len)
xs=[b[0][0] for b in boxes]+[b[0][0]+b[1][0] for b in boxes]; zs=[b[0][2] for b in boxes]+[b[0][2]+b[1][2] for b in boxes]
cx=(min(xs)+max(xs))//2; cz=(min(zs)+max(zs))//2; y0=min(b[0][1] for b in boxes)
palette=[];pm={};vox=[]
for (x,y,z),(sx,sy,sz),col in boxes:
    val=col if (sx,sy,sz)==(1,1,1) else f"{col}/cube/2/0/{sx},{sy},{sz}"
    if val not in pm: pm[val]=len(palette); palette.append(val)
    vox+=[int(x-cx),int(y-y0),int(z-cz),pm[val]]
size=min(gs for gs in [8,16,24,32,48,64,128] if gs>=TARGET)
json.dump({'format':'cubostudio','version':2,'size':size,'palette':palette,'voxels':vox,'stickers':[],'name':'Gogeta estilo bloque','bevel':'flat'},open(OUT,'w'))
print(f'B={B} cubos grandes {coarse.sum()} · celdas {len(cells)} · superficie {len(surf)} · piezas {len(boxes)}')
