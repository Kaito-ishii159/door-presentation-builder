"""Generate only fictional four-page estimates, raster scans and a floorplan.
Requires reportlab, Pillow and a Japanese TrueType font; no customer input.
"""
import argparse
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('--output', default='/tmp/doorboard-ocr-qa')
parser.add_argument('--font', default='/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
pages = json.loads((root/'tests/fixtures/layout-pages.json').read_text())
pdfmetrics.registerFont(TTFont('Japanese', args.font))
width, height = 842, 595
scale = 200/72
bounds = [.05,.17,.35,.60,.78,.95]
fields = ['id','room','sku','type','size']
centers = [.1,.23,.45,.66,.84]
text_pdf = canvas.Canvas(str(out/'fictional-estimate-text.pdf'), pagesize=(width,height))
scan_pdf = canvas.Canvas(str(out/'fictional-estimate-scan.pdf'), pagesize=(width,height))
font = ImageFont.truetype(args.font, round(13*scale))
for page in pages:
    im = Image.new('RGB',(round(width*scale),round(height*scale)),'white')
    draw = ImageDraw.Draw(im)
    title = f'架空のOCR検証用見積書 - 実在の案件ではありません - {page["number"]}/4'
    text_pdf.setFont('Japanese',15)
    text_pdf.drawString(42, height*.91, title)
    draw.text((42*scale,height*.065*scale),title,font=font,fill='black')
    for token in page['tokens']:
        col = min(range(5),key=lambda i:abs(token['x']-centers[i]))
        x = (bounds[col]+.012)*width
        y = token['y']*height
        text_pdf.setFont('Japanese',13)
        text_pdf.drawString(x,height-y-4,token['text'])
        draw.text((round(x*scale),round((y-8)*scale)),token['text'],font=font,fill='black')
    im.save(out/f'fictional-page-{page["number"]}.png')
    text_pdf.showPage()
    scan_pdf.drawImage(ImageReader(im),0,0,width=width,height=height)
    scan_pdf.showPage()
text_pdf.save()
scan_pdf.save()
c=canvas.Canvas(str(out/'fictional-floorplan.pdf'),pagesize=(width,height))
c.setFont('Japanese',20);c.drawString(45,540,'架空の図面 - 縮尺なし')
c.rect(70,90,700,390);c.line(400,90,400,480)
c.drawString(170,290,'玄関');c.drawString(540,290,'洋室①');c.save()
im=Image.new('RGB',(240,360),'#f6f8f4');d=ImageDraw.Draw(im)
d.rectangle((50,20,190,335),fill='#bed5ca',outline='#3b6559',width=5)
d.ellipse((164,177,174,187),fill='#3b6559');im.save(out/'fictional-door.png')
(out/'truth.json').write_text((root/'tests/fixtures/truth.json').read_text())
print(f'Fictional fixtures saved to {out}')
