import sys
sys.path.insert(0,'/tmp/claude-0/-home-user/3b4ee352-6452-5849-a786-9fba6fe474dd/scratchpad/pylib')
import numpy as np, glob
from scipy import ndimage as ndi
from PIL import Image
def flatmask(a,lv,tol=8,sd=3.0,minarea=60):
    g=a.mean(2);neutral=(a.max(2)-a.min(2))<=6
    mu=ndi.uniform_filter(g,5);var=ndi.uniform_filter(g*g,5)-mu**2;flat=var<sd*sd
    core=neutral&flat&((abs(g-lv[0])<=tol)|(abs(g-lv[1])<=tol))
    core=ndi.binary_opening(core,structure=np.ones((3,3)))
    lab,n=ndi.label(core);sz=ndi.sum(core,lab,range(1,n+1));core=np.isin(lab,[i+1 for i,s in enumerate(sz) if s>=minarea])
    # grow across cell boundaries (transition pixels) up to 3px through neutral in-range pixels
    inr=neutral&(g>=min(lv)-12)&(g<=max(lv)+12)
    bg=core.copy()
    for _ in range(3): bg=ndi.binary_dilation(bg,structure=np.ones((3,3)))&inr|core
    # remove small enclosed fg specks that are neutral grey surrounded by bg
    fg=~bg;lab,n=ndi.label(fg);sz=ndi.sum(fg,lab,range(1,n+1))
    small=np.isin(lab,[i+1 for i,s in enumerate(sz) if s<40]);bg|=small
    return bg
if __name__=='__main__':
    f=[x for x in glob.glob('art/*.png') if Image.open(x).size==(1472,720)][0]
    im=Image.open(f).convert('RGB');a=np.array(im).astype(float)
    bg=flatmask(a,(107,168));np.save('bgE.npy',bg);print(bg.mean())
    rgba=np.dstack([a,np.where(bg,0,255)]).astype(np.uint8);out=Image.fromarray(rgba,'RGBA')
    b=Image.new('RGBA',im.size,(40,70,110,255));b.alpha_composite(out);b.convert('RGB').save('prevE.png')
