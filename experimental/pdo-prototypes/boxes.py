# Prototipo: cada pieza de papel del .pdo → una pieza deformada ("caja chueca") de CuboStudio
import json, sys, math
import numpy as np
from collections import Counter, defaultdict
from load import load, GOGETA
CUBES=float(sys.argv[1]) if len(sys.argv)>1 else 30
MINT=float(sys.argv[2]) if len(sys.argv)>2 else 0.35   # medio grosor mínimo (en cubos)
SKIP={0}
objs,mats=load(GOGETA)
rng=np.random.default_rng(1)
# Puntos de cada pieza de papel (muestreo por área) con su color de textura
parts=defaultdict(lambda: {'p':[], 'c':[], 'n':[]})
allp=[]
for oi,(V,F) in enumerate(objs):
    for mat,part,vs in F:
        if mat in SKIP: continue
        tex=mats[mat][1]
        idx=[i for i,_,_ in vs]; uv=np.array([(u,v) for _,u,v in vs])
        for t in range(1,len(vs)-1):
            tri=[0,t,t+1]; P=V[[idx[j] for j in tri]]; UV=uv[tri]
            area=np.linalg.norm(np.cross(P[1]-P[0],P[2]-P[0]))/2
            n=max(3,int(area*400))
            r=rng.random((n,2)); m=r.sum(1)>1; r[m]=1-r[m]
            w=np.c_[1-r.sum(1),r]
            pts=w@P; uvs=w@UV
            if tex is not None:
                h,wd,_=tex.shape
                cols=tex[np.clip((uvs[:,1]%1*h).astype(int),0,h-1),np.clip((uvs[:,0]%1*wd).astype(int),0,wd-1)]
            else: cols=np.tile(np.array(mats[mat][0][4:7])*255,(n,1))
            nrm=np.cross(P[1]-P[0],P[2]-P[0]); nrm/=np.linalg.norm(nrm)+1e-12
            key=(oi,part)
            parts[key]['p'].append(pts); parts[key]['c'].append(cols); parts[key]['n'].append(np.tile(nrm,(n,1)))
            allp.append(pts)
allp=np.vstack(allp)
mn=allp.min(0); mx=allp.max(0)
s=CUBES/(mx-mn).max()
off=np.array([-(mn[0]+mx[0])/2*s, -mn[1]*s, -(mn[2]+mx[2])/2*s])
THICK=float(sys.argv[3]) if len(sys.argv)>3 else 1.6   # grosor máximo de una pieza antes de partirla
TIP=0.12
def fit(P):
    c=P.mean(0); Q=P-c
    w,E=np.linalg.eigh(np.cov(Q.T)); E=E[:,::-1]
    if np.linalg.det(E)<0: E[:,2]*=-1
    L=Q@E
    t0,t1=L[:,0].min(),L[:,0].max(); Lt=t1-t0
    ends=[]
    for lo,hi in ((t0,t0+TIP*Lt),(t1-TIP*Lt,t1)):
        S=L[(L[:,0]>=lo)&(L[:,0]<=hi)]
        if len(S)<3: S=L
        ends.append(((S[:,1].min()+S[:,1].max())/2, (S[:,1].max()-S[:,1].min())/2,
                     (S[:,2].min()+S[:,2].max())/2, (S[:,2].max()-S[:,2].min())/2))
    thick=L[:,2].max()-L[:,2].min()
    return c,E,L,t0,t1,ends,thick
def pieces_of(P,C,depth=0):
    c,E,L,t0,t1,ends,thick=fit(P)
    if thick>THICK and len(P)>80 and depth<4:
        # Pieza muy curva: se parte a la mitad por su lado más largo (e1 o e2)
        ax=0 if (t1-t0)>=(L[:,1].max()-L[:,1].min()) else 1
        cut=np.median(L[:,ax]); m=L[:,ax]<=cut
        return pieces_of(P[m],C[m],depth+1)+pieces_of(P[~m],C[~m],depth+1)
    return [(c,E,t0,t1,ends,C)]
def to_piece(c,E,t0,t1,ends,C):
    ends=[(c2,max(MINT,h2),c3,max(MINT,h3)) for c2,h2,c3,h3 in ends]
    def corner(e,a,b):
        c2,h2,c3,h3=ends[e]
        return c+E@np.array([t0 if e==0 else t1, c2+(h2 if a else -h2), c3+(h3 if b else -h3)])
    used=set(); la=[None]*3; sg=[1]*3
    for a in sorted(range(3), key=lambda a:-np.abs(E[a]).max()):
        k=max((k for k in range(3) if k not in used), key=lambda k:abs(E[a,k]))
        used.add(k); la[a]=k; sg[a]=1 if E[a,k]>0 else -1
    hexc=[]
    for i in range(8):
        bits=[(i>>a)&1 for a in range(3)]; side=[0,0,0]
        for a in range(3): side[la[a]]=bits[a] if sg[a]>0 else 1-bits[a]
        hexc.append(corner(side[0],side[1],side[2]))
    hexc=np.array(hexc)
    bins=Counter(map(tuple,(C//16).astype(int)))
    top=bins.most_common(1)[0][0]; sel=C[((C//16).astype(int)==top).all(1)]
    return hexc,'#%02x%02x%02x'%tuple(sel.mean(0).astype(int))
raw=[]
for key,d in parts.items():
    P=np.vstack(d['p'])*s+off; C=np.vstack(d['c'])
    for pc in pieces_of(P,C): raw.append(to_piece(*pc))
# Todo dentro de la cuadrícula: la base en el piso y centrada
allc=np.vstack([h for h,_ in raw])
lo=allc.min(0); hi=allc.max(0)
shift=np.array([-(lo[0]+hi[0])/2, -lo[1], -(lo[2]+hi[2])/2])
pieces=[]
for hexc,col in raw:
    hexc=hexc+shift
    bmin=hexc.min(0); size=np.maximum(hexc.max(0)-bmin,0.05)
    deform=[]
    for i in range(8):
        base=bmin+np.array([(i>>a)&1 for a in range(3)])*size
        deform+=list((hexc[i]-base)/size)
    cell=np.floor(bmin).astype(int); o=bmin-cell
    # sin deformar: caja recta, redondeada a pasos de 0.1
    size=np.maximum(np.round(size,1),0.1); o=np.round(o,1)
    pieces.append((cell,f"{col}/cube/2/0/{size[0]:.1f},{size[1]:.1f},{size[2]:.1f}/{o[0]:.1f},{o[1]:.1f},{o[2]:.1f}"))
print('caja total',(hi-lo).round(1))
palette=[]; pm={}; vox=[]
for cell,val in pieces:
    if val not in pm: pm[val]=len(palette); palette.append(val)
    vox+=[int(cell[0]),int(cell[1]),int(cell[2]),pm[val]]
out={'format':'cubostudio','version':2,'size':32,'palette':palette,'voxels':vox,'stickers':[],'name':'Gogeta bloques','bevel':'flat'}
json.dump(out,open('gogeta-boxes.json','w'))
print('piezas',len(pieces))
