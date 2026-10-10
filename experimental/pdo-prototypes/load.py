import struct, zlib
import numpy as np
GOGETA="/Users/mau/Downloads/emi/Old/Paper/Chibis/Anime/Dragon ball/Gogeta SSJ4/Gogeta SSJ4 avatar - Dragon Ball FighterZ - JPOPpapercraft (con lineas).pdo"
def load(path, start=None):
    import generic
    b=open(path,'rb').read()
    o0,_,_,_=generic.parse(b) if start is None else (start,0,0,0)
    o=[o0]
    def i32():
        v=struct.unpack_from('<i',b,o[0])[0]; o[0]+=4; return v
    def u8():
        v=b[o[0]]; o[0]+=1; return v
    def f64(k):
        v=struct.unpack_from('<%dd'%k,b,o[0]); o[0]+=8*k; return v
    objs=[]
    for _ in range(i32()):
        L=i32(); o[0]+=L; u8(); nv=i32()
        V=np.array(struct.unpack_from('<%dd'%(3*nv),b,o[0])).reshape(nv,3); o[0]+=24*nv
        faces=[]
        for _ in range(i32()):
            mat=i32(); part=i32(); f64(4); k=i32(); vs=[]
            for _ in range(k):
                idx=i32(); f64(2); u,v=f64(2); u8(); f64(3); o[0]+=24; vs.append((idx,u,v))
            faces.append((mat,part,vs))
        ne=i32(); o[0]+=22*ne; objs.append((V,faces))
    mats=[]
    for _ in range(i32()):
        L=i32(); o[0]+=L; c=struct.unpack_from('<20f',b,o[0]); o[0]+=80; has=u8()
        tex=None
        if has:
            w=i32(); h=i32(); n=i32(); raw=zlib.decompress(b[o[0]:o[0]+n]); o[0]+=n
            tex=np.frombuffer(raw,np.uint8).reshape(h,w,3)
        mats.append((c,tex))
    return objs,mats
