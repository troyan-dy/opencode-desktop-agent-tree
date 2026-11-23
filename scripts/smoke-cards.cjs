// node scripts/smoke-cards.cjs /path/to/chrome — isolated real-DOM check of the shipped card renderer.
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {execFileSync}=require("node:child_process"),{pathToFileURL}=require("node:url");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"oc-card-check-"));
const source=name=>fs.readFileSync(path.join(__dirname,"../src",name+".cjs"),"utf8");
function scenario(){
  const check=(value,why)=>{if(!value)throw Error(why)};
  document.head.appendChild(document.createElement("style")).textContent=view.css;
  const branch=document.querySelector("ul"),count=document.querySelector("output"),box=document.querySelector("section");
  const paint=view.createCardView(branch,count);
  const row=(id,state,children=[])=>({id,state,task:`Задание ${id}`,agent:"general",children});
  const leaf=row("child","Завершил работу"),parent=row("parent","Завершил работу",[leaf]);
  const root=row("root","Пишет ответ",[parent,...Array.from({length:20},(_,i)=>row(String(i),"Завершил работу"))]);
  paint({tree:root});check(count.textContent==="Субагенты: 22","wrong subtree count");
  const fold=()=>branch.querySelector("details");
  check(!fold().open && fold().querySelector("summary").textContent.includes("22"),"long history not folded");
  const summary=fold().querySelector("summary");summary.click();summary.focus();
  paint({tree:root});check(fold().open && document.activeElement===fold().querySelector("summary"),"lost disclosure/focus");
  fold().open=false;leaf.state="Ждёт разрешения";leaf.task="x".repeat(120);paint({tree:root,changed:leaf});
  const card=branch.querySelector('[data-mark="wait"]');
  check(card?.getBoundingClientRect().height>0 && !card.closest("details:not([open])"),"resumed path hidden");
  check(card.querySelector(".at-state path").getAttribute("d").length>0,"missing icon");
  check(getComputedStyle(card).borderInlineStartWidth==="4px","missing stripe");
  check(getComputedStyle(card.parentElement.parentElement).borderInlineStartWidth==="1px","missing tree connector");
  check(box.scrollWidth<=box.clientWidth+1,"long task overflows narrow panel");
  root.children=[];paint({tree:root,empty:true});
  check(count.textContent==="Субагенты: 0" && branch.querySelectorAll(".at-card").length===1 && !!branch.querySelector(".at-empty"),"invented child");
  paint({tree:root,empty:false});check(!branch.querySelector(".at-empty"),"stale empty state");
  document.body.dataset.result="pass";
}
try{
  const file=path.join(dir,"cards.html");
  const wrap=name=>`((module,require)=>{${source(name)}\nreturn module.exports;})`;
  fs.writeFileSync(file,`<!doctype html><meta charset="utf-8"><section class="oc-agent-tree" style="width:224px;height:500px"><output></output><ul></ul></section><script>
  const cards=${wrap("cards")}({exports:{}}),view=${wrap("card-view")}({exports:{}},()=>cards);
  try{(${scenario})()}catch(e){document.body.dataset.failure=e.message}
  </script>`);
  const html=execFileSync(process.argv[2],["--headless","--disable-gpu","--no-first-run","--disable-extensions",
    `--user-data-dir=${path.join(dir,"profile")}`,"--dump-dom",pathToFileURL(file).href],{encoding:"utf8",timeout:30000,stdio:["ignore","pipe","ignore"]});
  if(!html.includes('<body data-result="pass">')) throw Error(html.match(/<body[^>]*>/)?.[0]||"no rendered document");
  console.log("PASS: 224px panel, stripes, connections, icons, history disclosure and focus, resumed branch, empty and stale states.");
}finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:150})}
