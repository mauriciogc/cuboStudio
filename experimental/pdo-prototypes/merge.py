# B: los cubitos de 32 se juntan en cajas grandes del mismo color (cubos de distintos tamaños)
import json
d=json.load(open('/Users/mau/Documents/poke/muestras/Gogeta SSJ4 (32).cubos.json'))
pal=d['palette']; v=d['voxels']
cells={(v[i],v[i+1],v[i+2]):pal[v[i+3]] for i in range(0,len(v),4)}
done=set(); boxes=[]
for k in sorted(cells, key=lambda c:(c[1],c[2],c[0])):
    if k in done: continue
    col=cells[k]; x0,y0,z0=k
    ok=lambda c: c in cells and c not in done and cells[c]==col
    # crecer en x
    x1=x0
    while ok((x1+1,y0,z0)): x1+=1
    # crecer en z (filas completas)
    z1=z0
    while all(ok((x,y0,z1+1)) for x in range(x0,x1+1)): z1+=1
    # crecer en y (capas completas)
    y1=y0
    while all(ok((x,y1+1,z)) for x in range(x0,x1+1) for z in range(z0,z1+1)): y1+=1
    for x in range(x0,x1+1):
        for y in range(y0,y1+1):
            for z in range(z0,z1+1): done.add((x,y,z))
    boxes.append(((x0,y0,z0),(x1-x0+1,y1-y0+1,z1-z0+1),col))
palette=[]; pm={}; vox=[]
for c,s,col in boxes:
    val=col if s==(1,1,1) else f"{col}/cube/2/0/{s[0]},{s[1]},{s[2]}"
    if val not in pm: pm[val]=len(palette); palette.append(val)
    vox+=[*c,pm[val]]
json.dump({**d,'palette':palette,'voxels':vox,'name':'Gogeta SSJ4 (cajas)'},open('gogeta-merged.json','w'))
print('cubitos',len(cells),'→ cajas',len(boxes), 'más grande',max(s[0]*s[1]*s[2] for _,s,_ in boxes))
