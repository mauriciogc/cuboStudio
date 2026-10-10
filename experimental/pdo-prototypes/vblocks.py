# Prototipo 2: volumen → zonas compactas (k-means con posición y color) → una caja chueca por zona
import json, sys
import numpy as np
from collections import Counter, deque
from load import load, GOGETA
RES=int(sys.argv[1]) if len(sys.argv)>1 else 48     # resolución del volumen
K=int(sys.argv[2]) if len(sys.argv)>2 else 110        # cuántos bloques
CW=float(sys.argv[3]) if len(sys.argv)>3 else 0.06    # peso del color al agrupar
OUT=float(sys.argv[4]) if len(sys.argv)>4 else 30     # tamaño final (cubos)
SKIP={0}
objs,mats=load(GOGETA)
rng=np.random.default_rng(2)
pts=[];cols=[]
for V,F in objs:
    for mat,part,vs in F:
        if mat in SKIP: continue
        tex=mats[mat][1]; idx=[i for i,_,_ in vs]; uv=np.array([(u,v) for _,u,v in vs])
        for t in range(1,len(vs)-1):
            tri=[0,t,t+1]; P=V[[idx[j] for j in tri]]; UV=uv[tri]
            area=np.linalg.norm(np.cross(P[1]-P[0],P[2]-P[0]))/2
            n=max(4,int(area*3000))
            r=rng.random((n,2)); m=r.sum(1)>1; r[m]=1-r[m]; w=np.c_[1-r.sum(1),r]
            p=w@P; q=w@UV; h,wd,_=tex.shape
            pts.append(p); cols.append(tex[np.clip((q[:,1]%1*h).astype(int),0,h-1),np.clip((q[:,0]%1*wd).astype(int),0,wd-1)])
pts=np.vstack(pts); cols=np.vstack(cols).astype(float)
mn=pts.min(0); mx=pts.max(0); s=(RES-0.01)/(mx-mn).max()
g=np.floor((pts-mn)*s).astype(int)
dims=g.max(0)+1
# color de cada celda de la cáscara: el tono más repetido
cell={}
order=np.lexsort((g[:,2],g[:,1],g[:,0]))
keys=g[order]; cc=cols[order]
start=0
for i in range(1,len(keys)+1):
    if i==len(keys) or (keys[i]!=keys[start]).any():
        c=cc[start:i]; b=(c//16).astype(int)
        top=Counter(map(tuple,b)).most_common(1)[0][0]; sel=c[(b==top).all(1)]
        cell[tuple(keys[start])]=sel.mean(0); start=i
# rellenar por dentro (lo que no se alcanza desde afuera), con el color de la cáscara más cercana
occ=np.zeros(dims+2,bool)
for k in cell: occ[k[0]+1,k[1]+1,k[2]+1]=True
out=np.zeros_like(occ); out[0,0,0]=True; dq=deque([(0,0,0)])
N6=[(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
while dq:
    x,y,z=dq.popleft()
    for dx,dy,dz in N6:
        a,b2,c=x+dx,y+dy,z+dz
        if 0<=a<occ.shape[0] and 0<=b2<occ.shape[1] and 0<=c<occ.shape[2] and not out[a,b2,c] and not occ[a,b2,c]:
            out[a,b2,c]=True; dq.append((a,b2,c))
front=list(cell.keys())
while front:
    nxt=[]
    for k in front:
        for dx,dy,dz in N6:
            n=(k[0]+dx,k[1]+dy,k[2]+dz)
            if n in cell or out[n[0]+1,n[1]+1,n[2]+1]: continue
            if not (0<=n[0]<dims[0] and 0<=n[1]<dims[1] and 0<=n[2]<dims[2]): continue
            cell[n]=cell[k]; nxt.append(n)
    front=nxt
P=np.array(list(cell.keys()),float)+0.5; C=np.array(list(cell.values()))
print('volumen',len(P),'celdas')
# k-means con posición + color (el color separa pelo, cara y ropa)
X=np.c_[P, C*CW]
cent=X[rng.choice(len(X),K,replace=False)]
for it in range(40):
    d=((X[:,None,:]-cent[None,:,:])**2).sum(2); lab=d.argmin(1)
    new=np.array([X[lab==k].mean(0) if (lab==k).any() else cent[k] for k in range(K)])
    if np.allclose(new,cent): break
    cent=new
TIP=0.15
def hexa(Q):
    c=Q.mean(0)
    if len(Q)<4:
        E=np.eye(3)
    else:
        w,E=np.linalg.eigh(np.cov((Q-c).T)); E=E[:,::-1]
        if np.linalg.det(E)<0: E[:,2]*=-1
    L=(Q-c)@E
    t0,t1=L[:,0].min()-0.5,L[:,0].max()+0.5; Lt=t1-t0
    ends=[]
    for lo,hi in ((t0,t0+TIP*Lt+0.5),(t1-TIP*Lt-0.5,t1)):
        S=L[(L[:,0]>=lo)&(L[:,0]<=hi)]
        if len(S)<1: S=L
        ends.append(((S[:,1].min()+S[:,1].max())/2,(S[:,1].max()-S[:,1].min())/2+0.5,(S[:,2].min()+S[:,2].max())/2,(S[:,2].max()-S[:,2].min())/2+0.5))
    def corner(e,a,b):
        c2,h2,c3,h3=ends[e]
        return c+E@np.array([t0 if e==0 else t1, c2+(h2 if a else -h2), c3+(h3 if b else -h3)])
    used=set(); la=[None]*3; sg=[1]*3
    for a in sorted(range(3), key=lambda a:-np.abs(E[a]).max()):
        k=max((k for k in range(3) if k not in used), key=lambda k:abs(E[a,k]))
        used.add(k); la[a]=k; sg[a]=1 if E[a,k]>0 else -1
    out=[]
    for i in range(8):
        bits=[(i>>a)&1 for a in range(3)]; side=[0,0,0]
        for a in range(3): side[la[a]]=bits[a] if sg[a]>0 else 1-bits[a]
        out.append(corner(*side))
    return np.array(out)
raw=[]
for k in range(K):
    m=lab==k
    if m.sum()<2: continue
    Q=P[m]; cc=C[m]; b=(cc//16).astype(int)
    top=Counter(map(tuple,b)).most_common(1)[0][0]; col=cc[(b==top).all(1)].mean(0)
    raw.append((hexa(Q),'#%02x%02x%02x'%tuple(col.astype(int))))
# escala final a OUT cubos, base en el piso y centrada
allc=np.vstack([h for h,_ in raw]); lo=allc.min(0); hi=allc.max(0)
sc=OUT/(hi-lo).max()
pieces=[]
for hexc,col in raw:
    hexc=(hexc-lo)*sc; hexc[:,0]-=(hi[0]-lo[0])*sc/2; hexc[:,2]-=(hi[2]-lo[2])*sc/2
    bmin=hexc.min(0); size=np.maximum(hexc.max(0)-bmin,0.05)
    deform=[]
    for i in range(8):
        base=bmin+np.array([(i>>a)&1 for a in range(3)])*size
        deform+=list((hexc[i]-base)/size)
    cellk=np.floor(bmin).astype(int); o=bmin-cellk
    shape='deform:'+','.join(f'{v:.3f}'.rstrip('0').rstrip('.') if abs(v)>1e-4 else '0' for v in deform)
    pieces.append((cellk,f"{col}/{shape}/2/0/{size[0]:.3f},{size[1]:.3f},{size[2]:.3f}/{o[0]:.3f},{o[1]:.3f},{o[2]:.3f}"))
palette=[]; pm={}; vox=[]
for c,val in pieces:
    if val not in pm: pm[val]=len(palette); palette.append(val)
    vox+=[int(c[0]),int(c[1]),int(c[2]),pm[val]]
json.dump({'format':'cubostudio','version':2,'size':32,'palette':palette,'voxels':vox,'stickers':[],'name':'Gogeta bloques','bevel':'flat'},open('gogeta-vblocks.json','w'))
print('bloques',len(pieces))
