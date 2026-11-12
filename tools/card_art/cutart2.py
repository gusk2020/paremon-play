import sys
sys.path.insert(0,'/tmp/claude-0/-home-user/3b4ee352-6452-5849-a786-9fba6fe474dd/scratchpad/pylib')
import numpy as np, glob
from scipy import ndimage as ndi
from PIL import Image
def lvls(a):
    g=a.mean(2);neutral=(a.max(2)-a.min(2))<=4
    loc=np.sqrt(np.maximum(ndi.uniform_filter(g*g,5)-ndi.uniform_filter(g,5)**2,0));m=neutral&(loc<3)
    h=np.bincount(g[m].astype(int),minlength=256).astype(float);h=np.convolve(h,np.ones(5)/5,'same')
    p1=int(np.argmax(h));h2=h.copy();h2[max(0,p1-12):p1+13]=0;p2=int(np.argmax(h2));return sorted([p1,p2])
def score(v,neutral,xs,ys,P,x0,y0,lv):
    par=(np.floor((xs-x0)/P)+np.floor((ys-y0)/P))%2;ex=np.where(par==0,lv[0],lv[1])
    return ((np.abs(v-ex)<=8)&neutral).mean()
def grid_model(a):
    g=a.mean(2);h,w=g.shape;rng=np.random.default_rng(1);lv=lvls(a)
    ys=rng.integers(0,h,50000);xs=rng.integers(0,w,50000);v=g[ys,xs];neutral=(a.max(2)-a.min(2))[ys,xs]<=6
    best=(0,)
    for P in np.arange(11.5,16.01,0.1):
        for x0 in np.arange(0,2*P,1.5):
            for y0 in np.arange(0,2*P,1.5):
                sc=score(v,neutral,xs,ys,P,x0,y0,lv)
                if sc>best[0]:best=(sc,P,x0,y0,lv[0],lv[1])
    return best
def refine(a,best):
    g=a.mean(2);h,w=g.shape;rng=np.random.default_rng(2);lv=[best[4],best[5]]
    ys=rng.integers(0,h,150000);xs=rng.integers(0,w,150000);v=g[ys,xs];neutral=(a.max(2)-a.min(2))[ys,xs]<=6
    _,P,x0,y0,_,_=best;bb=best
    for dp in np.arange(-0.1,0.101,0.01):
        for dx in np.arange(-1.5,1.51,0.25):
            for dy in np.arange(-1.5,1.51,0.25):
                sc=score(v,neutral,xs,ys,P+dp,x0+dx,y0+dy,lv)
                if sc>bb[0]:bb=(sc,P+dp,x0+dx,y0+dy,lv[0],lv[1])
    return bb
def expected_bg(shape,m):
    h,w=shape;_,P,x0,y0,l0,l1=m
    yy,xx=np.mgrid[0:h,0:w];par=(np.floor((xx-x0)/P)+np.floor((yy-y0)/P))%2
    return np.where(par==0,l0,l1)
def bg_mask(a,tol=14,win=2):
    m=refine(a,grid_model(a)); ex=expected_bg(a.shape[:2],m)
    neutral=(a.max(2)-a.min(2))<=7
    match=neutral&(np.abs(a.mean(2)-ex)<=tol)
    pure=ndi.binary_erosion(match,structure=np.ones((3,3)),iterations=win)
    pure=ndi.binary_dilation(pure,structure=np.ones((3,3)),iterations=win+1)&((np.abs(a.mean(2)-ex)<=tol+10)&neutral)   # grow back (+1px halo)
    return pure,m
if __name__=='__main__':
    for f in sorted(glob.glob('art/*.png')):
        im=Image.open(f)
        if im.size not in [(1472,720),(1790,879),(1792,878)]: continue
        a=np.array(im.convert('RGB')).astype(float);bg,m=bg_mask(a)
        print(f.split('/')[-1][:10],im.size,'model P=%.3f x0=%.1f y0=%.1f levels %.0f/%.0f matchfrac %.3f'%(m[1],m[2],m[3],m[4],m[5],m[0]),'bg%',round(bg.mean(),3))
        rgba=np.dstack([a,np.where(bg,0,255)]).astype(np.uint8);out=Image.fromarray(rgba,'RGBA')
        bgim=Image.new('RGBA',im.size,(40,70,110,255));bgim.alpha_composite(out);bgim.convert('RGB').save('prev2_'+f.split('/')[-1][:8]+'.png')
