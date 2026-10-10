# Prototipo "intermedio": cubos juntados + esquinas de afuera acercadas a la superficie real
import json, sys
import numpy as np
from collections import Counter, deque, defaultdict
from PIL import Image
from load import load, GOGETA
RES=int(sys.argv[1]) if len(sys.argv)>1 else 32
NCOL=int(sys.argv[2]) if len(sys.argv)>2 else 24
MAXD=float(sys.argv[3]) if len(sys.argv)>3 else 0.9   # cuánto puede moverse una esquina (en cubos)
OUT=sys.argv[4] if len(sys.argv)>4 else 'gogeta-smooth.json'
TARGET=int(sys.argv[5]) if len(sys.argv)>5 else 32
SKIP={0}
objs,mats=load(GOGETA)
rng=np.random.default_rng(3)
pts=[];cols=[]
for V,F in objs:
    for mat,part,vs in F:
        if mat in SKIP: continue
        tex=mats[mat][1]; idx=[i for i,_,_ in vs]; uv=np.array([(u,v) for _,u,v in vs])
        for t in range(1,len(vs)-1):
            tri=[0,t,t+1]; P=V[[idx[j] for j in tri]]; UV=uv[tri]
            area=np.linalg.norm(np.cross(P[1]-P[0],P[2]-P[0]))/2
            n=max(6,int(area*4000))
            r=rng.random((n,2)); m=r.sum(1)>1; r[m]=1-r[m]; w=np.c_[1-r.sum(1),r]
            p=w@P; q=w@UV; h,wd,_=tex.shape
            pts.append(p); cols.append(tex[np.clip((q[:,1]%1*h).astype(int),0,h-1),np.clip((q[:,0]%1*wd).astype(int),0,wd-1)])
pts=np.vstack(pts); cols=np.vstack(cols).astype(float)
mn=pts.min(0); mx=pts.max(0); s=(RES-0.01)/(mx-mn).max()
G=(pts-mn)*s                      # puntos de la superficie, en cubos
g=np.floor(G).astype(int)
# color por celda (tono más repetido)
cell={}
order=np.lexsort((g[:,2],g[:,1],g[:,0])); keys=g[order]; cc=cols[order]; st=0
for i in range(1,len(keys)+1):
    if i==len(keys) or (keys[i]!=keys[st]).any():
        c=cc[st:i]; b=(c//16).astype(int); top=Counter(map(tuple,b)).most_common(1)[0][0]
        cell[tuple(keys[st])]=c[(b==top).all(1)].mean(0); st=i
# rellenar por dentro
dims=np.array(g.max(0))+1
occ=np.zeros(dims+2,bool)
for k in cell: occ[k[0]+1,k[1]+1,k[2]+1]=True
outside=np.zeros_like(occ); outside[0,0,0]=True; dq=deque([(0,0,0)])
N6=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
while dq:
    x,y,z=dq.popleft()
    for dx,dy,dz in N6:
        a,b2,c=x+dx,y+dy,z+dz
        if 0<=a<occ.shape[0] and 0<=b2<occ.shape[1] and 0<=c<occ.shape[2] and not outside[a,b2,c] and not occ[a,b2,c]:
            outside[a,b2,c]=True; dq.append((a,b2,c))
front=list(cell)
while front:
    nxt=[]
    for k in front:
        for dx,dy,dz in N6:
            n=(k[0]+dx,k[1]+dy,k[2]+dz)
            if n in cell or not all(0<=n[i]<dims[i] for i in range(3)) or outside[n[0]+1,n[1]+1,n[2]+1]: continue
            cell[n]=cell[k]; nxt.append(n)
    front=nxt
# colores: NCOL (1 = tono neutro)
ks=list(cell)
if NCOL<=1: colmap={k:'#ece6dc' for k in ks}
else:
    img=Image.new('RGB',(len(ks),1)); img.putdata([tuple(int(v) for v in cell[k]) for k in ks])
    q=img.quantize(colors=NCOL,method=Image.Quantize.MEDIANCUT); pal=q.getpalette()
    colmap={k:'#%02x%02x%02x'%tuple(pal[i*3:i*3+3]) for k,i in zip(ks,q.getdata())}
occupied=set(ks)
# juntar en cajas del mismo color, probando los 3 órdenes de crecimiento y quedándose con el que da menos cajas
def merge(order):
    done=set(); out=[]
    ax=order
    for k in sorted(ks,key=lambda c:(c[ax[2]],c[ax[1]],c[ax[0]])):
        if k in done: continue
        col=colmap[k]
        ok=lambda c: c in colmap and c not in done and colmap[c]==col
        lo=list(k); hi=list(k)
        def can(axis):
            r=[range(lo[i],hi[i]+1) for i in range(3)]; r[axis]=[hi[axis]+1]
            return all(ok((x,y,z)) for x in r[0] for y in r[1] for z in r[2])
        for axis in ax:
            while can(axis): hi[axis]+=1
        for x in range(lo[0],hi[0]+1):
            for y in range(lo[1],hi[1]+1):
                for z in range(lo[2],hi[2]+1): done.add((x,y,z))
        out.append((tuple(lo),tuple(hi[i]-lo[i]+1 for i in range(3)),col))
    return out
boxes=min((merge(o) for o in [(0,2,1),(2,0,1),(1,0,2),(0,1,2)]), key=len)
SC=TARGET/RES
pieces=[]
for (x0,y0,z0),(sx,sy,sz),col in boxes:
    mnp=np.array([x0,y0,z0])*SC; sz_=np.array([sx,sy,sz])*SC
    cellk=np.floor(mnp+1e-9).astype(int); off=np.round(mnp-cellk,3)
    f=lambda v: ('%.3f'%v).rstrip('0').rstrip('.')
    if (sz_==1).all() and (off==0).all(): val=col
    elif (off==0).all(): val=f"{col}/cube/2/0/{f(sz_[0])},{f(sz_[1])},{f(sz_[2])}"
    else: val=f"{col}/cube/2/0/{f(sz_[0])},{f(sz_[1])},{f(sz_[2])}/{f(off[0])},{f(off[1])},{f(off[2])}"
    pieces.append((tuple(cellk),val))
xs=[c[0] for c,_ in pieces]; zs=[c[2] for c,_ in pieces]
cx=(min(xs)+max(xs)+1)//2; cz=(min(zs)+max(zs)+1)//2
size=min(gs for gs in [8,16,24,32,48,64,128] if gs>=TARGET)
palette=[];pm={};vox=[]
for (x,y,z),val in pieces:
    if val not in pm: pm[val]=len(palette); palette.append(val)
    vox+=[int(x-cx),int(y),int(z-cz),pm[val]]
json.dump({'format':'cubostudio','version':2,'size':size,'palette':palette,'voxels':vox,'stickers':[],'name':'Gogeta cajas','bevel':'flat'},open(OUT,'w'))
print('detalle',RES,'→',TARGET,'· celdas',len(ks),'· cajas',len(boxes))
