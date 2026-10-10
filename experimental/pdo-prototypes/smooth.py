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
SMOOTH=int(sys.argv[5]) if len(sys.argv)>5 else 2
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
def exposed_cell(k):
    x,y,z=k
    return any((x+dx,y+dy,z+dz) not in occupied for dx in (-1,0,1) for dy in (-1,0,1) for dz in (-1,0,1))
# los cubos de la superficie van sueltos (cada uno ajusta sus esquinas); sólo se juntan los de adentro
surface=set(k for k in ks if exposed_cell(k))
done=set(); boxes=[]
for k in surface:
    done.add(k); boxes.append((k,(1,1,1),colmap[k]))
for k in sorted(ks,key=lambda c:(c[1],c[2],c[0])):
    if k in done: continue
    col=colmap[k]; x0,y0,z0=k
    ok=lambda c: c in colmap and c not in done and c not in surface and colmap[c]==col
    x1=x0
    while ok((x1+1,y0,z0)): x1+=1
    z1=z0
    while all(ok((x,y0,z1+1)) for x in range(x0,x1+1)): z1+=1
    y1=y0
    while all(ok((x,y1+1,z)) for x in range(x0,x1+1) for z in range(z0,z1+1)): y1+=1
    for x in range(x0,x1+1):
        for y in range(y0,y1+1):
            for z in range(z0,z1+1): done.add((x,y,z))
    boxes.append(((x0,y0,z0),(x1-x0+1,y1-y0+1,z1-z0+1),col))
# esquinas de afuera → al punto de la superficie más cercano (búsqueda por cuadrícula)
bucket=defaultdict(list)
for i,p in enumerate(G): bucket[tuple(np.floor(p).astype(int))].append(i)
def exposed(c):
    x,y,z=c
    return any((x-dx,y-dy,z-dz) not in occupied for dx in (0,1) for dy in (0,1) for dz in (0,1))
# 1) cada esquina de afuera va al promedio de los puntos de superficie cercanos (no al más cercano: eso arruga)
# 2) luego se suaviza con sus esquinas vecinas (sin pasar de MAXD)
lattice=set()
for (x0,y0,z0),(sx,sy,sz),_ in boxes:
    for i in range(8):
        lattice.add((x0+((i>>0)&1)*sx, y0+((i>>1)&1)*sy, z0+((i>>2)&1)*sz))
moved={}
R2=0.85**2
for c in lattice:
    t=np.array(c,float)
    if exposed(c):
        near=[]
        for dx in (-2,-1,0,1):
            for dy in (-2,-1,0,1):
                for dz in (-2,-1,0,1):
                    for i in bucket.get((c[0]+dx,c[1]+dy,c[2]+dz),[]):
                        if ((G[i]-t)**2).sum()<R2: near.append(G[i])
        if near: t=np.mean(near,0)
    moved[c]=t
orig={c:np.array(c,float) for c in lattice}
for it in range(SMOOTH):
    nxt={}
    for c,t in moved.items():
        if not exposed(c): nxt[c]=t; continue
        nb=[moved[n] for n in ((c[0]+1,c[1],c[2]),(c[0]-1,c[1],c[2]),(c[0],c[1]+1,c[2]),(c[0],c[1]-1,c[2]),(c[0],c[1],c[2]+1),(c[0],c[1],c[2]-1)) if n in moved and exposed(n)]
        v=0.5*t+0.5*np.mean(nb,0) if nb else t
        d=v-orig[c]; L=np.linalg.norm(d)
        if L>MAXD: v=orig[c]+d*(MAXD/L)
        nxt[c]=v
    moved=nxt
def target(c): return moved[c]
pieces=[]; nmov=0
for (x0,y0,z0),(sx,sy,sz),col in boxes:
    size=np.array([sx,sy,sz],float); base=np.array([x0,y0,z0],float)
    off=[]
    for i in range(8):
        b=[(i>>a)&1 for a in range(3)]
        corner=(x0+b[0]*sx,y0+b[1]*sy,z0+b[2]*sz)
        t=target(corner)
        off+=list((t-np.array(corner,float))/size)
    if any(abs(v)>1e-4 for v in off):
        nmov+=1
        shape='deform:'+','.join(f'{v:.3f}'.rstrip('0').rstrip('.') if abs(v)>1e-4 else '0' for v in off)
        val=f"{col}/{shape}/2/0/{sx},{sy},{sz}"
    else:
        val=col if (sx,sy,sz)==(1,1,1) else f"{col}/cube/2/0/{sx},{sy},{sz}"
    pieces.append(((x0,y0,z0),val))
# centrar en la cuadrícula
xs=[c[0] for c,_ in pieces]; zs=[c[2] for c,_ in pieces]
cx=(min(xs)+max(xs)+1)//2; cz=(min(zs)+max(zs)+1)//2
size=min(gs for gs in [8,16,24,32,48,64,128] if gs>=RES)
palette=[];pm={};vox=[]
for (x,y,z),val in pieces:
    if val not in pm: pm[val]=len(palette); palette.append(val)
    vox+=[int(x-cx),int(y),int(z-cz),pm[val]]
json.dump({'format':'cubostudio','version':2,'size':size,'palette':palette,'voxels':vox,'stickers':[],'name':'Gogeta intermedio','bevel':'flat'},open(OUT,'w'))
print('celdas',len(ks),'cajas',len(boxes),'deformadas',nmov)
