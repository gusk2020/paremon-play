import sys
sys.path.insert(0,'/tmp/claude-0/-home-user/3b4ee352-6452-5849-a786-9fba6fe474dd/scratchpad/pylib')
sys.path.insert(0,'.')
import numpy as np, glob
from scipy import ndimage as ndi
from PIL import Image
import cutart2 as c2
WIN=80;STEP=40
def local_phases(a,m):
    g=a.mean(2);neutral=(a.max(2)-a.min(2))<=6;h,w=g.shape;_,P,X0,Y0,l0,l1=m
    ny=(h-WIN)//STEP+2;nx=(w-WIN)//STEP+2
    ph=np.zeros((ny,nx,3));cands=np.arange(-5,5.01,0.5)
    for j in range(ny):
        for i in range(nx):
            y1=min(j*STEP,h-WIN);x1=min(i*STEP,w-WIN)
            gg=g[y1:y1+WIN:2,x1:x1+WIN:2];nn=neutral[y1:y1+WIN:2,x1:x1+WIN:2]
            yy,xx=np.mgrid[y1:y1+WIN:2,x1:x1+WIN:2]
            best=(-1,0,0)
            for dx in cands:
                px=np.floor((xx-X0-dx)/P)
                for dy in cands:
                    par=(px+np.floor((yy-Y0-dy)/P))%2
                    ex=np.where(par==0,l0,l1);sc=((np.abs(gg-ex)<=6)&nn).mean()
                    if sc>best[0]:best=(sc,dx,dy)
            ph[j,i]=best
    return ph
def smooth_fill(ph):
    good=ph[...,0]>0.55
    out=ph.copy()
    for j in range(ph.shape[0]):
        for i in range(ph.shape[1]):
            if not good[j,i]:
                best=None
                for r in range(1,8):
                    js=slice(max(0,j-r),j+r+1);is_=slice(max(0,i-r),i+r+1)
                    gg=good[js,is_]
                    if gg.any():
                        out[j,i,1]=np.median(ph[js,is_,1][gg]);out[j,i,2]=np.median(ph[js,is_,2][gg]);break
    return out
def bgmask(a):
    m=c2.refine(a,c2.grid_model(a));ph=smooth_fill(local_phases(a,m))
    g=a.mean(2);h,w=g.shape;_,P,X0,Y0,l0,l1=m
    yy,xx=np.mgrid[0:h,0:w]
    wj=np.clip(((yy-WIN/2)/STEP+0.5).astype(int),0,ph.shape[0]-1);wi=np.clip(((xx-WIN/2)/STEP+0.5).astype(int),0,ph.shape[1]-1)
    dx=ph[wj,wi,1];dy=ph[wj,wi,2]
    par=(np.floor((xx-X0-dx)/P)+np.floor((yy-Y0-dy)/P))%2;ex=np.where(par==0,l0,l1)
    neutral=(a.max(2)-a.min(2))<=7
    match=neutral&(np.abs(g-ex)<=9)
    # edge pixels (antialias between cells): allow neutral pixels between levels adjacent to matches
    near=ndi.binary_dilation(match,iterations=1)
    edge=neutral&near&(g>=min(l0,l1)-9)&(g<=max(l0,l1)+9)
    bg=match|edge
    bg=ndi.binary_opening(bg,structure=np.ones((3,3)))
    return bg,m,ph
if __name__=='__main__':
    import pickle
    for f in sorted(glob.glob('art/*.png')):
        im=Image.open(f)
        if im.size not in [(1472,720),(1790,879),(1792,878)]: continue
        a=np.array(im.convert('RGB')).astype(float);bg,m,ph=bgmask(a)
        tag=f.split('/')[-1][:8];np.save('bg_'+tag+'.npy',bg)
        print(tag,round(bg.mean(),3),'local phase spread',ph[...,1].min(),ph[...,1].max(),ph[...,2].min(),ph[...,2].max())
        rgba=np.dstack([a,np.where(bg,0,255)]).astype(np.uint8);out=Image.fromarray(rgba,'RGBA')
        bgim=Image.new('RGBA',im.size,(40,70,110,255));bgim.alpha_composite(out);bgim.convert('RGB').save('prev3_'+tag+'.png')
