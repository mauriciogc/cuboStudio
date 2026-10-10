import struct, zlib, sys
class Bad(Exception): pass
def parse_from(b, o):
    n=len(b)
    def need(k):
        if o_[0]+k>n: raise Bad('eof')
    o_=[o]
    def i32():
        need(4); v=struct.unpack_from('<i',b,o_[0])[0]; o_[0]+=4; return v
    def u8():
        need(1); v=b[o_[0]]; o_[0]+=1; return v
    def skip(k):
        need(k); o_[0]+=k
    def f64(k):
        need(8*k); v=struct.unpack_from('<%dd'%k,b,o_[0]); o_[0]+=8*k; return v
    nobj=i32()
    if not 1<=nobj<=500: raise Bad('nobj')
    objs=[]
    for _ in range(nobj):
        L=i32()
        if not 0<=L<=1000: raise Bad('name')
        skip(L)
        if u8() not in (0,1): raise Bad('vis')
        nv=i32()
        if not 0<=nv<=2_000_000: raise Bad('nv')
        V=[f64(3) for _ in range(nv)]
        for v in V[:20]:
            if any(abs(x)>1e7 or x!=x for x in v): raise Bad('vval')
        nf=i32()
        if not 0<=nf<=4_000_000: raise Bad('nf')
        faces=[]
        for _ in range(nf):
            mat=i32(); part=i32(); f64(4); k=i32()
            if not 3<=k<=64: raise Bad('k')
            vs=[]
            for _ in range(k):
                idx=i32()
                if not 0<=idx<nv: raise Bad('idx')
                f64(2); u,v=f64(2); u8(); f64(3); skip(24)
                vs.append((idx,u,v))
            faces.append((mat,vs))
        ne=i32()
        if not 0<=ne<=8_000_000: raise Bad('ne')
        skip(22*ne)
        objs.append((V,faces))
    nm=i32()
    if not 0<=nm<=500: raise Bad('nm')
    mats=[]
    for _ in range(nm):
        L=i32()
        if not 0<=L<=1000: raise Bad('mname')
        skip(L); skip(80); has=u8()
        if has not in (0,1): raise Bad('has')
        tex=None
        if has:
            w=i32(); h=i32(); c=i32()
            if not (0<w<=16384 and 0<h<=16384 and 0<c<=n): raise Bad('tex')
            need(c); raw=zlib.decompress(b[o_[0]:o_[0]+c]); o_[0]+=c
            if len(raw)!=w*h*3: raise Bad('texlen %d %d'%(len(raw),w*h*3))
            tex=(w,h)
        mats.append(tex)
    return objs, mats, o_[0]
def parse(b):
    if not b.startswith(b'version 3\n'): raise Bad('version')
    last=None
    for o in range(10, min(len(b)-8, 4000)):
        try:
            return (o,)+parse_from(b,o)
        except (Bad, struct.error, zlib.error) as e:
            last=e
    raise Bad('no encontrado')
if __name__=='__main__':
    ok=0
    for f in open('list.txt').read().splitlines():
        b=open(f,'rb').read()
        try:
            o,objs,mats,end=parse(b)
            nf=sum(len(fa) for _,fa in objs)
            print('OK  ', hex(o), 'obj',len(objs),'caras',nf,'mats',len(mats),'tex',sum(1 for m in mats if m),'resto',len(b)-end, f.split('/')[-1][:45])
            ok+=1
        except Exception as e:
            print('FAIL',repr(e)[:60], f.split('/')[-1][:45])
    print(ok,'de',len(open('list.txt').read().splitlines()))
