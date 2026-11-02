// DoorBoard Studio prototype — all uploaded files are processed in this browser.
// No customer PDFs, drawings or product images are committed to the public repository.
const PDFJS_BASE_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38";
const DEMO_ITEMS = [
  {id:"WD-1",room:"玄関",type:"片引戸",sku:"DEMO-H001",size:"W1600 × H2400",color:"ホワイト"},
  {id:"WD-2",room:"洋室①",type:"片開戸",sku:"DEMO-D002",size:"W803 × H2400",color:"ホワイト"},
  {id:"WD-3",room:"トイレ①",type:"片開戸",sku:"DEMO-D003",size:"W650 × H2400",color:"ホワイト"},
  {id:"WD-4",room:"洗面所",type:"片引戸",sku:"DEMO-H004",size:"W1600 × H2400",color:"ホワイト"},
  {id:"WD-5",room:"洋室②",type:"収納折戸",sku:"DEMO-F005",size:"W1715 × H2400",color:"ホワイト"}
];
const $ = id => document.getElementById(id);
const state = {
  items: DEMO_ITEMS.map(x=>({...x,image:null})),
  pins: {}, selected:"WD-1", tab:"catalog",
  planUrl:"./assets/sample-floorplan.svg", planName:"架空サンプル間取り図",
  planLabels:[
    {text:"玄関",x:0.21,y:0.76},{text:"洋室①",x:0.28,y:0.27},
    {text:"トイレ①",x:0.82,y:0.27},{text:"洗面所",x:0.12,y:0.54},
    {text:"洋室②",x:0.60,y:0.30},{text:"LDK",x:0.72,y:0.74}
  ],
  estimateFile:null, planFile:null, pdfjs:null
};
const esc = v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
function status(message){$("status-msg").textContent=message;}
function cleanId(v){return String(v||"").trim().replace(/\s/g,"").toUpperCase().replace(/^WD-?(\d+)$/,"WD-$1").slice(0,24);}
function normalizeRoom(v){return String(v||"").replace(/\s|・|[（）()]/g,"").replace(/Ｌ/g,"L").replace(/Ｄ/g,"D").replace(/Ｋ/g,"K").toLowerCase();}
function doorSvg(type="片開戸",color="ホワイト"){
  const isSlide=/引戸|引き戸/.test(type), isFold=/折戸|収納/.test(type);
  const fill=/黒|ブラック/.test(color)?"#4d5251":/木|オーク|ナチュラル/.test(color)?"#b2a28b":"#e5e9e4";
  const body = isSlide
    ?'<rect x="20" y="12" width="66" height="116" rx="1" fill="'+fill+'" stroke="#87988d" stroke-width="2"/><path d="M44 12 v116" stroke="#b3c0b7"/><rect x="70" y="64" width="3" height="17" rx="1" fill="#7d8b85"/>'
    : isFold
    ?'<rect x="21" y="12" width="65" height="116" fill="'+fill+'" stroke="#87988d" stroke-width="2"/><path d="M43 12 v116 M65 12 v116" stroke="#9aaba1" stroke-width="2"/><circle cx="58" cy="72" r="2.5" fill="#7d8b85"/>'
    :'<rect x="28" y="12" width="56" height="116" rx="1" fill="'+fill+'" stroke="#87988d" stroke-width="2"/><circle cx="74" cy="77" r="2.8" fill="#88988e"/>';
  return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="110" height="142" viewBox="0 0 110 142"><rect width="110" height="142" fill="#f8faf8"/>'+body+'<path d="M10 132 H100" stroke="#dfe5df" stroke-width="2"/></svg>');
}
function itemImage(item){return item.image||doorSvg(item.type,item.color);}
function updateMetrics(){
  $("total-count").textContent=state.items.length;
  $("placed-count").textContent=Object.keys(state.pins).filter(id=>state.items.some(x=>x.id===id)).length;
  $("image-count").textContent=state.items.filter(x=>!!x.image).length;
}
function renderItems(){
  $("item-list").innerHTML=state.items.map((item,i)=>`
    <article class="item-card" data-id="${esc(item.id)}">
      <div class="item-card-head"><span class="door-id">${esc(item.id)}</span><b>${esc(item.room||"設置場所未設定")}</b><button type="button" class="delete-button" data-delete="${i}" title="削除" aria-label="この建具を削除">×</button></div>
      <div class="form-grid">
        <label>建具番号<input data-index="${i}" data-field="id" value="${esc(item.id)}" aria-label="建具番号" maxlength="24"/></label>
        <label>設置場所<input data-index="${i}" data-field="room" value="${esc(item.room)}" aria-label="設置場所"/></label>
        <label>建具種類<input data-index="${i}" data-field="type" value="${esc(item.type)}" aria-label="建具種類"/></label>
        <label>品番<input data-index="${i}" data-field="sku" value="${esc(item.sku)}" aria-label="品番"/></label>
        <label>寸法<input data-index="${i}" data-field="size" value="${esc(item.size)}" aria-label="寸法"/></label>
        <label>色・仕上げ<input data-index="${i}" data-field="color" value="${esc(item.color)}" aria-label="色・仕上げ"/></label>
      </div>
      <div class="item-image-row">
        <label class="image-label">📷 ${item.image?"商品画像を変更":"商品画像を登録"}<input type="file" accept="image/*" data-image="${i}" aria-label="商品画像"/></label>
        <button type="button" class="card-mini-action" data-select="${i}">図面で選択 ↗</button>
      </div>
    </article>`).join("");
}
function catalogTiles(){
 return state.items.map(item=>`<article class="product-tile"><img class="product-image" src="${esc(itemImage(item))}" alt="建具の参考画像"/><div class="product-info"><span class="product-num">${esc(item.id)}</span><h5>${esc(item.room||"設置場所未設定")}</h5><p>${esc(item.type||"種類未設定")}</p><p>品番：${esc(item.sku||"未設定")}</p><p>寸法：${esc(item.size||"未設定")}</p><p>色：${esc(item.color||"未設定")}</p></div></article>`).join("");
}
function renderCatalog(){$("catalog-grid").innerHTML=catalogTiles()||'<p class="notice">建具を追加してください。</p>';}
function renderSelector(){
 if(!state.items.some(x=>x.id===state.selected)) state.selected=state.items[0]?.id||"";
 $("selected-door").innerHTML=state.items.map(x=>`<option value="${esc(x.id)}" ${x.id===state.selected?"selected":""}>${esc(x.id)} ／ ${esc(x.room)}</option>`).join("");
}
function renderPins(){
 $("pin-layer").innerHTML=Object.entries(state.pins).filter(([id])=>state.items.some(x=>x.id===id)).map(([id,p])=>`<button type="button" class="pin ${id===state.selected?"selected":""}" data-pin="${esc(id)}" style="left:${clamp(Number(p.x)||0,0,1)*100}%;top:${clamp(Number(p.y)||0,0,1)*100}%" title="${esc(id)}：ドラッグして移動">${esc(id)}</button>`).join("");
 $("placement-list").innerHTML=state.items.map(x=>`<button type="button" class="placement-chip ${state.pins[x.id]?"active":"missing"}" data-choose="${esc(x.id)}">${esc(x.id)} ${state.pins[x.id]?"✓ 配置済み":"＋ 未配置"}</button>`).join("");
 updateMetrics();
}
function renderAll(){renderItems();renderCatalog();renderSelector();renderPins();updateMetrics();}
function setTab(name){
 state.tab=name;
 $("catalog-view").hidden=name!=="catalog";
 $("plan-view").hidden=name!=="plan";
 document.querySelectorAll("[data-tab]").forEach(b=>{b.classList.toggle("active",b.dataset.tab===name);b.setAttribute("aria-selected",String(b.dataset.tab===name));});
}
async function pdfjs(){
 if(!state.pdfjs){
  state.pdfjs=import(`${PDFJS_BASE_URL}/build/pdf.min.mjs`).then(m=>{
    m.GlobalWorkerOptions.workerSrc=`${PDFJS_BASE_URL}/build/pdf.worker.min.mjs`;return m;
  }).catch(e=>{state.pdfjs=null;throw e;});
 }
 return state.pdfjs;
}
async function openPdf(file){
 const lib=await pdfjs(), data=new Uint8Array(await file.arrayBuffer());
 // Non-embedded Japanese CID fonts need the matching PDF.js character maps.
 return lib.getDocument({
  data,
  cMapUrl:`${PDFJS_BASE_URL}/cmaps/`,
  cMapPacked:true,
  standardFontDataUrl:`${PDFJS_BASE_URL}/standard_fonts/`
 }).promise;
}
function groupLines(contents){
 const groups=[];
 for(const item of contents.items||[]){
  if(!item.str?.trim())continue;
  const y=item.transform[5],x=item.transform[4];
  let group=groups.find(g=>Math.abs(g.y-y)<3.8);
  if(!group){group={y,parts:[]};groups.push(group);}
  group.parts.push({x,str:item.str.trim()});
 }
 return groups.sort((a,b)=>b.y-a.y).map(g=>g.parts.sort((a,b)=>a.x-b.x).map(x=>x.str).join(" "));
}
function detectRoom(text){
 const t=String(text).replace(/\s/g,"");
 return t.match(/洋室[①②③④⑤0-9]?|トイレ[①②0-9]?|洗面所|玄関|パントリー|クローゼット|LDK|ＬＤＫ|ホール|WIC|ＷＩＣ|収納|SC|脱衣所/)?.[0]||"要確認";
}
function detectType(text){return text.match(/片引[き]?戸|上吊り引戸|両開き収納|４枚折戸|4枚折戸|折戸|片開[き]?戸|引戸|ドア|収納/)?.[0]||"要確認";}
function extractItems(text){
 const re=/\bWD[\s\-－]*(\d{1,3})\b/gi, found=[...text.matchAll(re)];
 const unique=new Map();
 for(let i=0;i<found.length;i++){
  const m=found[i],id="WD-"+Number(m[1]),segment=text.slice(m.index,Math.min(m.index+340,found[i+1]?.index??text.length));
  if(unique.has(id))continue;
  const sku=segment.match(/\b(?:AN[A-Z0-9-]{5,}|[A-Z]{2,5}[A-Z0-9-]{5,})\b/i)?.[0]||"";
  let size="";
  const wh=segment.match(/W\s*=?\s*(\d{3,4})[^\n]{0,35}?H\s*=?\s*(\d{3,4})/i);
  const dim=segment.match(/\b(\d{3,4})\s*[×xX＊*]\s*(\d{3,4})\b/);
  if(wh)size="W"+wh[1]+" × H"+wh[2];else if(dim)size="W"+dim[1]+" × H"+dim[2];
  unique.set(id,{id,room:detectRoom(segment),type:detectType(segment),sku,size,color:"要確認",image:null});
 }
 return [...unique.values()].slice(0,100);
}
async function readEstimate(file,{ocr=false}={}){
 const btn=$("ocr-btn");
 try{
  status(ocr?"OCRを準備しています…":"見積書の文字情報を抽出しています…");
  const pdf=await openPdf(file);let chunks=[];const maxPages=Math.min(pdf.numPages,ocr?3:20);
  let worker=null;
  if(ocr){
   if(!window.Tesseract)throw new Error("OCRライブラリを読み込めませんでした。ネット接続をご確認ください。");
   worker=await window.Tesseract.createWorker("jpn+eng",1,{logger:m=>{if(m.status==="recognizing text")status("OCR解析中… "+Math.round((m.progress||0)*100)+"%");}});
  }
  try{
   for(let n=1;n<=maxPages;n++){
    const page=await pdf.getPage(n);
    if(ocr){
     const raw=page.getViewport({scale:1}),scale=Math.min(2.1,2500/raw.width);
     const viewport=page.getViewport({scale}),canvas=document.createElement("canvas");
     canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
     await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
     const result=await worker.recognize(canvas);
     chunks.push(result.data.text||"");
    }else{
     const content=await page.getTextContent();
     chunks.push(groupLines(content).join("\n"));
    }
   }
  }finally{if(worker)await worker.terminate();await pdf.destroy();}
  const parsed=extractItems(chunks.join("\n"));
  if(parsed.length){
   state.items=parsed;state.pins={};state.selected=parsed[0].id;renderAll();
   status(parsed.length+"件の候補を抽出しました。全項目の確認・修正をお願いします。");
  }else{
   status(ocr?"建具番号を検出できませんでした。手動で追加・修正してください。":"文字情報から建具番号を検出できませんでした。画像PDFならOCRをお試しください。");
  }
  btn.disabled=false;
 }catch(e){console.error(e);status("PDF読み取りに失敗しました："+e.message);btn.disabled=false;}
}
async function readFloorPlan(file){
 try{
  status("間取り図を読み込んでいます…");
  let url,labels=[];
  if(file.type.startsWith("image/")){
   url=await fileToDataUrl(file);
  }else{
   const pdf=await openPdf(file),page=await pdf.getPage(1);
   const raw=page.getViewport({scale:1}),scale=Math.min(2.1,2200/raw.width);
   const viewport=page.getViewport({scale});
   const canvas=document.createElement("canvas");
   canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
   await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;
   url=canvas.toDataURL("image/png");
   const content=await page.getTextContent(),dim=page.getViewport({scale:1});
   labels=content.items.filter(x=>x.str?.trim()).map(item=>{
    const [x,y]=dim.convertToViewportPoint(item.transform[4],item.transform[5]);
    return {text:item.str.trim(),x:clamp(x/dim.width,0,1),y:clamp(y/dim.height,0,1)};
   });
   await pdf.destroy();
  }
  state.planUrl=url;state.planName=file.name;state.planLabels=labels;state.pins={};
  $("plan-image").src=url;$("plan-name").textContent=file.name;
  setTab("plan");renderPins();status("間取り図を読み込みました。建具番号を配置してください。");
 }catch(e){console.error(e);status("間取り図の読み込みに失敗しました："+e.message);}
}
function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}
function suggestion(){
 if(!state.planLabels.length){status("この図面には部屋名のテキスト座標がありません。手動で配置してください。");return;}
 let count=0;
 for(const item of state.items){
  if(state.pins[item.id])continue;
  const room=normalizeRoom(item.room);
  if(!room||room==="要確認")continue;
  let label=state.planLabels.find(x=>normalizeRoom(x.text)===room);
  if(!label)label=state.planLabels.find(x=>normalizeRoom(x.text).includes(room)&&room.length>=2);
  if(!label)continue;
  // A text label is not a door location. The candidate must always be checked and moved.
  state.pins[item.id]={x:clamp(label.x+.015,0.05,.95),y:clamp(label.y-.025,0.05,.95),source:"room-label"};
  count++;
 }
 renderPins();status(count?"部屋名の位置に"+count+"件を仮配置しました。実際の建具開口部へ必ず移動してください。":"一致する部屋名がありません。手動で配置してください。");
}
function planCoordinate(e){
 const rect=$("plan-stage").getBoundingClientRect();
 return{x:clamp((e.clientX-rect.left)/rect.width,.02,.98),y:clamp((e.clientY-rect.top)/rect.height,.02,.98)};
}
let dragId=null,dragMoved=false;
$("plan-stage").addEventListener("pointerdown",e=>{
 const pin=e.target.closest(".pin");if(!pin)return;
 dragId=pin.dataset.pin;dragMoved=false;state.selected=dragId;
 pin.setPointerCapture?.(e.pointerId);renderSelector();
});
$("plan-stage").addEventListener("pointermove",e=>{
 if(!dragId)return;
 dragMoved=true;state.pins[dragId]={...planCoordinate(e),source:"manual"};
 const pin=[...document.querySelectorAll(".pin")].find(x=>x.dataset.pin===dragId);
 if(pin){pin.style.left=(state.pins[dragId].x*100)+"%";pin.style.top=(state.pins[dragId].y*100)+"%";}
});
$("plan-stage").addEventListener("pointerup",e=>{
 if(dragId){dragId=null;renderPins();}
});
$("plan-stage").addEventListener("pointercancel",()=>{dragId=null;renderPins();});
$("plan-stage").addEventListener("click",e=>{
 if(e.target.closest(".pin"))return;
 if(!state.selected){status("先に配置する建具を選択してください。");return;}
 state.pins[state.selected]={...planCoordinate(e),source:"manual"};renderPins();
 status(state.selected+"を配置しました。ドラッグで微調整できます。");
});
$("item-list").addEventListener("input",e=>{
 const el=e.target,idx=Number(el.dataset.index),field=el.dataset.field;
 if(!field||!Number.isInteger(idx)||!state.items[idx])return;
 const item=state.items[idx],oldId=item.id;
 item[field]=field==="id"?cleanId(el.value):el.value;
 if(field==="id"&&item.id!==oldId){
  if(state.pins[oldId]){state.pins[item.id]=state.pins[oldId];delete state.pins[oldId];}
  if(state.selected===oldId)state.selected=item.id;
 }
 renderCatalog();renderSelector();renderPins();
});
$("item-list").addEventListener("change",async e=>{
 const el=e.target;
 if(!el.matches("[data-image]")||!el.files?.[0])return;
 const idx=Number(el.dataset.image);
 if(!state.items[idx])return;
 if(el.files[0].size>8*1024*1024){status("商品画像は8MB以内にしてください。");return;}
 try{state.items[idx].image=await fileToDataUrl(el.files[0]);renderAll();status("商品画像を更新しました。");}
 catch(e){status("画像を読み込めませんでした。");}
});
$("item-list").addEventListener("click",e=>{
 const del=e.target.closest("[data-delete]");
 if(del){
  const idx=Number(del.dataset.delete),item=state.items[idx];
  if(!item)return;
  delete state.pins[item.id];state.items.splice(idx,1);renderAll();status(item.id+"を削除しました。");return;
 }
 const select=e.target.closest("[data-select]");
 if(select){
  const item=state.items[Number(select.dataset.select)];
  if(item){state.selected=item.id;setTab("plan");renderSelector();renderPins();status(item.id+"を選択中。図面をクリックして配置してください。");}
 }
});
$("add-btn").addEventListener("click",()=>{
 const used=new Set(state.items.map(x=>x.id));let i=1;
 while(used.has("WD-"+i))i++;
 state.items.push({id:"WD-"+i,room:"",type:"片開戸",sku:"",size:"",color:"",image:null});
 state.selected="WD-"+i;renderAll();status("建具を追加しました。");
});
$("reset-btn").addEventListener("click",()=>{
 if(!confirm("現在の編集内容を消して、架空のサンプルデータに戻しますか？"))return;
 state.items=DEMO_ITEMS.map(x=>({...x,image:null}));state.pins={};state.selected="WD-1";
 state.planUrl="./assets/sample-floorplan.svg";state.planName="架空サンプル間取り図";
 state.planLabels=[{text:"玄関",x:.21,y:.76},{text:"洋室①",x:.28,y:.27},{text:"トイレ①",x:.82,y:.27},{text:"洗面所",x:.12,y:.54},{text:"洋室②",x:.60,y:.30},{text:"LDK",x:.72,y:.74}];
 state.estimateFile=null;state.planFile=null;
 $("plan-image").src=state.planUrl;$("plan-name").textContent="ファイルを選択";$("estimate-name").textContent="ファイルを選択";$("ocr-btn").disabled=true;
 $("estimate-file").value="";$("plan-file").value="";
 setTab("catalog");renderAll();status("架空のデモデータに戻しました。");
});
document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.tab)));
$("selected-door").addEventListener("change",e=>{state.selected=e.target.value;renderPins();});
$("clear-selected-btn").addEventListener("click",()=>{
 if(!state.pins[state.selected]){status("この建具はまだ配置されていません。");return;}
 delete state.pins[state.selected];renderPins();status(state.selected+"の配置を解除しました。");
});
$("placement-list").addEventListener("click",e=>{
 const chip=e.target.closest("[data-choose]");if(!chip)return;
 state.selected=chip.dataset.choose;renderSelector();renderPins();
 status(state.selected+"を選択中。図面をクリックして配置してください。");
});
$("suggest-btn").addEventListener("click",suggestion);
$("estimate-file").addEventListener("change",async e=>{
 const f=e.target.files?.[0];if(!f)return;
 if(f.size>25*1024*1024){status("PDFは25MB以内にしてください。");return;}
 state.estimateFile=f;$("estimate-name").textContent=f.name;$("ocr-btn").disabled=false;
 await readEstimate(f);
});
$("ocr-btn").addEventListener("click",async()=>{if(state.estimateFile)await readEstimate(state.estimateFile,{ocr:true});});
$("plan-file").addEventListener("change",async e=>{
 const f=e.target.files?.[0];if(!f)return;
 if(f.size>25*1024*1024){status("図面は25MB以内にしてください。");return;}
 state.planFile=f;await readFloorPlan(f);
});
$("save-json-btn").addEventListener("click",()=>{
 const payload={version:1,items:state.items,pins:state.pins,planName:state.planName,planUrl:state.planUrl.startsWith("data:")?state.planUrl:null};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="doorboard-workspace.json";a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);status("編集データをJSONで保存しました。個人情報が含まれる場合は適切に保管してください。");
});
$("json-file").addEventListener("change",async e=>{
 const f=e.target.files?.[0];if(!f)return;
 try{
  if(f.size>35*1024*1024)throw new Error("ファイルが大きすぎます");
  const raw=JSON.parse(await f.text());
  if(!Array.isArray(raw.items)||raw.items.length>100)throw new Error("データ形式が正しくありません");
  state.items=raw.items.map(x=>({
   id:cleanId(x.id),room:String(x.room||"").slice(0,100),type:String(x.type||"").slice(0,100),
   sku:String(x.sku||"").slice(0,100),size:String(x.size||"").slice(0,100),
   color:String(x.color||"").slice(0,100),image:typeof x.image==="string"&&x.image.startsWith("data:image/")?x.image:null
  })).filter(x=>x.id);
  state.pins={};
  for(const [id,p]of Object.entries(raw.pins||{})){
   if(state.items.some(x=>x.id===id)&&Number.isFinite(p?.x)&&Number.isFinite(p?.y))
    state.pins[id]={x:clamp(p.x,0,1),y:clamp(p.y,0,1),source:"manual"};
  }
  if(typeof raw.planUrl==="string"&&raw.planUrl.startsWith("data:image/")){state.planUrl=raw.planUrl;$("plan-image").src=state.planUrl;}
  state.selected=state.items[0]?.id||"";renderAll();status("編集データを読み込みました。");
 }catch(error){status("JSONを読み込めませんでした："+error.message);}
 e.target.value="";
});
function printPins(){
 return Object.entries(state.pins).filter(([id])=>state.items.some(x=>x.id===id)).map(([id,p])=>`<span class="pin" style="left:${clamp(Number(p.x)||0,0,1)*100}%;top:${clamp(Number(p.y)||0,0,1)*100}%">${esc(id)}</span>`).join("");
}
$("export-btn").addEventListener("click",()=>{
 const paper=document.querySelector("#catalog-view .paper").cloneNode(true);
 const grid=paper.querySelector(".catalog-grid");grid.innerHTML=catalogTiles();
 const page1=document.createElement("section");page1.className="print-page";page1.appendChild(paper);
 const page2=document.createElement("section");page2.className="print-page";
 page2.innerHTML=`<h2 class="print-title">建具配置図</h2><div class="print-plan"><img src="${esc(state.planUrl)}" alt="建具配置図"/>${printPins()}</div><p class="print-note">設置位置・建具番号はメーカーによる最終確認が必要です。／ 間取り図：${esc(state.planName)}</p>`;
 $("print-root").replaceChildren(page1,page2);
 status("印刷ダイアログで「PDFとして保存」を選択してください。");
 requestAnimationFrame(()=>setTimeout(()=>window.print(),200));
});
renderAll();setTab("catalog");
