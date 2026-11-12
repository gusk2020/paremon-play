import sys;sys.path.insert(0,'/tmp/claude-0/-home-user/3b4ee352-6452-5849-a786-9fba6fe474dd/scratchpad/pylib');sys.path.insert(0,'.')
import numpy as np,glob
from PIL import Image,ImageDraw
from scipy import ndimage as ndi
import energy2 as e
def load(size):
    f=[x for x in glob.glob('art/*.png') if Image.open(x).size==size][0];return Image.open(f).convert('RGB')
def grow(a,bg,lv,rounds=8,tol=16,sd=6.0):
    g=a.mean(2);neutral=(a.max(2)-a.min(2))<=(14 if tol>20 else 10)
    mu=ndi.uniform_filter(g,3);var=ndi.uniform_filter(g*g,3)-mu**2;flat=var<sd*sd
    inr=neutral&flat&((abs(g-lv[0])<=tol)|(abs(g-lv[1])<=tol))
    for _ in range(rounds): bg=bg|(ndi.binary_dilation(bg,structure=np.ones((3,3)))&inr)
    return bg
def energy():
    a=np.array(load((1472,720))).astype(float)
    bg=e.flatmask(a,(107,168),tol=10,sd=4.0,minarea=25);bg=grow(a,bg,(107,168));bgy=grow(a,bg,(107,168),rounds=10,tol=24,sd=9.0);bg[53:343,990:1438]=bgy[53:343,990:1438]
    rects=[(38,58,482,340),(515,58,959,340),(992,58,1436,340),(38,378,482,664),(515,378,959,664),(992,378,1436,664)]
    names=['red','orange','yellow','green','blue','purple'];rgba=np.dstack([a,np.where(bg,0,255)]).astype(np.uint8)
    for n,(x0,y0,x1,y1) in zip(names,rects):
        c=rgba[y0:y1,x0:x1].copy();h,w=c.shape[:2]
        m=Image.new('L',(w*4,h*4),0);ImageDraw.Draw(m).rounded_rectangle((0,0,w*4-1,h*4-1),radius=18*4,fill=255);m=np.array(m.resize((w,h),Image.LANCZOS))
        c[...,3]=np.minimum(c[...,3],m);ci=Image.fromarray(c,'RGBA').resize((320,round(320*h/w)),Image.LANCZOS);ci.save(f'out/energy_{n}.png')
def cut(size,tag,lv,cols):
    a=np.array(load(size)).astype(float);bg=np.load(f'bg_{tag}.npy');bg=grow(a,bg,lv,rounds=6,tol=14,sd=5.0) if tag=='#U5897#U' else bg;nb=~bg
    nb=ndi.binary_opening(nb,structure=np.ones((2,2)))
    W=size[0]
    for k,nm in cols:
        x0,x1=int(W*k/5),int(W*(k+1)/5)
        sub=nb[:,x0:x1];lab,n=ndi.label(ndi.binary_dilation(sub,iterations=7));sz=ndi.sum(sub,lab,range(1,n+1))
        main=np.argmax(sz)+1;keep=(lab==main)&sub
        rgba=np.dstack([a[:,x0:x1],np.where(keep,255,0)]).astype(np.uint8)
        ys,xs=np.where(keep);c=Image.fromarray(rgba,'RGBA').crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1));s=400/max(c.size)
        c.resize((round(c.size[0]*s),round(c.size[1]*s)),Image.LANCZOS).save(f'out/{nm}.png')
energy()
# levels for tune/boost sheets
import cutart2 as c2
for size,tag,cols in [((1790,879),'#U8272#U',[(0,'tune_a'),(1,'tune_b')]),((1792,878),'#U5897#U',[(4,'boost')])]:
    a=np.array(load(size)).astype(float);lv=c2.lvls(a);print(tag,lv);cut(size,tag,lv,cols)
fs=['tune_a','tune_b','boost','energy_red','energy_yellow','energy_green']
for bgc,n in [((235,235,235),'light'),((30,40,60),'dark')]:
    B=Image.new('RGB',(1500,420),bgc);x=5
    for f in fs:
        c=Image.open(f'out/{f}.png');B.paste(c,(x,5),c);x+=c.size[0]+10
    B.save(f'board_{n}.png')
