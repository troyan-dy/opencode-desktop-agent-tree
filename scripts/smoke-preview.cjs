// node scripts/smoke-preview.cjs <Chrome executable> <unpacked solid-js@1.9.17 package directory>
// Exercise the actual overlay with the browser build of Solid and a controlled reactive message store.
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {execFileSync}=require("node:child_process"),{pathToFileURL}=require("node:url");
async function scenario(){
  const check=(v,why)=>{if(!v)throw Error(why)};
  const step=()=>new Promise(resolve=>setTimeout(resolve,0));
  const box=document.querySelector("aside"),card=box.querySelector("button"),chat=document.querySelector("[data-slot]"),draft=chat.querySelector("textarea");
  const route=location.href;draft.value="unsent draft";box.scrollTop=110;
  const y=box.scrollTop,branch=box.querySelector("details");check(y>0 && branch.open,"fixture is not scrolled and expanded");
  const [rows,setRows]=solid.createSignal([]),[more,setMore]=solid.createSignal(true),[online,setOnline]=solid.createSignal(true);
  let rejectSync=false,closeSignal,seen=[],syncs=0,finishSync;
  const store={list:()=>rows(),more,loading:()=>false,invalidate(){},async sync(id){
    syncs++;seen.push(id);
    if(rejectSync)throw Error("offline");
    if(id==="other")await new Promise(r=>{finishSync=r});
  },async loadMore(id,opts){
    closeSignal=opts.signal;opts.beforePublish();setRows(r=>[{id:"older",type:"user",text:"Previous task"},...r]);setMore(false);
  }};
  const server={get connected(){return online()},data:{session:{message:store,get:()=>({agent:"general",model:{id:"example"},outcome:"succeeded",time:{created:1,idle:3001}}),status:()=>"idle"}}};
  const uiButton=props=>{const b=document.createElement("button");b.type="button";b.className=props.class||"";b.textContent=props.label||props.children;b.setAttribute("aria-label",props.label||"");b.onclick=props.onClick;return b};
  const p=transcript.createPreview({Markdown:props=>()=>props.text,IconButton:uiButton,Button:uiButton,Icon:()=>document.createElement("i"),Keybind:()=>document.createTextNode("Esc")});
  const find=sel=>document.querySelector(".oc-agent-preview "+sel);
  const open=id=>p.open(server,{id,title:"Test "+id},card);
  open("child");await step();
  check(find(".ap-notice").textContent.includes("пока нет"),"missing empty state");
  setRows([{id:"u",type:"user",text:"Task"},{id:"a",type:"assistant",content:[{type:"text",text:"partial"}]}]);await step();
  check(find(".ap-feed").innerText.includes("partial"),"live message missing");
  setRows(r=>[r[0],{...r[1],content:[{type:"text",text:"final answer"}]}]);await step();
  check(find(".ap-feed").innerText.includes("final answer"),"stream not updated");
  check(syncs===1,"stream triggered a full reload");
  const tool=(id,name)=>({id,type:"tool",name,state:{status:"completed",input:{path:"example.js"},content:[{type:"text",text:"Result "+id}]}});
  setRows(r=>[r[0],{id:"t1",type:"assistant",content:[tool("one","read")]},{id:"t2",type:"assistant",content:[tool("two","grep")]},r[1]]);
  await step();
  check(find('[data-component="user-message"] [data-slot="user-message-fold"]')?.textContent==="Task","missing Desktop prompt bubble");
  check(find('[data-component="text-part"] [data-slot="text-part-body"]')?.textContent.includes("final answer"),"missing Desktop reply body");
  const group=find('[data-component="context-tool-group-trigger"]');
  check(group && group.innerText.includes("2") && !find(".ap-feed").innerText.includes("Result two"),"consecutive tools should start as one folded group");
  group.click();await step();
  check(group.innerText.includes("2"),"group label vanished on expansion");
  const item=find('[data-component="context-tool-group-list"] summary');
  check(item,"no tool details after expanding group");item.click();await step();
  check(find(".ap-feed").innerText.includes("Result one"),"individual tool result missing");
  setRows(r=>[...r,{id:"tail",type:"assistant",content:[{type:"text",text:"later"}]}]);await step();
  check(find(".ap-feed").innerText.includes("Result one"),"live update collapsed a group");
  check(find('footer')?.innerText.includes("Готово"),"missing native-style child status");
  check(!find(".ap-feed").innerText.split("\n").some(x=>x==="Агент"||x==="Поручение"),"repeated role captions");
  find(".ap-feed button").click();await step();
  check(find(".ap-feed").innerText.includes("Previous task"),"older page missing");
  setOnline(false);await step();check(find(".ap-notice").textContent.includes("Нет связи"),"offline state missing");
  rejectSync=true;setOnline(true);await step();
  check(find(".ap-notice").textContent.includes("Не удалось"),"load error hidden");
  rejectSync=false;find(".ap-notice+button").click();await step();check(!find(".ap-notice").textContent,"retry did not recover");
  const preview=document.querySelector("dialog"),rect=preview.getBoundingClientRect(),anchor=chat.getBoundingClientRect();
  check(rect.left>anchor.left && rect.right<anchor.right && rect.top>anchor.top && rect.bottom<anchor.bottom,"not inset over chat");
  check(!!preview.closest(":popover-open"),"floating Desktop composer can cover the preview");
  window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
  check(!document.querySelector("dialog") && closeSignal.aborted && document.activeElement===card,"escape/cleanup/focus failed");
  check(box.scrollTop===y && branch.open && draft.value==="unsent draft" && location.href===route,"changed sidebar, draft or route");
  open("other");await step();find(".ap-close").click();finishSync();await step();
  check(!document.querySelector("dialog") && seen.at(-1)==="other","late response reopened preview");
  document.body.dataset.result="pass";
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"oc-overlay-"));
try{
  const sources={"solid-js":path.join(process.argv[3],"dist/solid.cjs"),"solid-js/web":path.join(process.argv[3],"web/dist/web.cjs")};
  for(const n of ["cards","card-view","timeline","transcript"])sources["./"+n+".cjs"]=path.join(__dirname,"../src",n+".cjs");
  const factories=Object.entries(sources).map(([id,file])=>JSON.stringify(id)+":function(require,module,exports){"+fs.readFileSync(file,"utf8")+"\n}");
  const file=path.join(temp,"test.html");
  fs.writeFileSync(file,`<!doctype html><meta charset=utf-8><style>[data-pane-row]{display:flex;height:90vh}aside{width:25%;overflow:auto}main{position:relative;flex:1}</style>
  <div data-pane-row><aside class="oc-agent-tree"><div style="height:120px"></div><details open><summary>History</summary><button data-session-id="child">Child</button></details><div style="height:100vh"></div></aside><main data-slot="session-chat-panel"><textarea></textarea></main></div>
  <script>const factories={${factories.join(",")}},cache={};function req(id){if(!cache[id]){const m={exports:{}};cache[id]=m;factories[id](req,m,m.exports)}return cache[id].exports}
  const solid=req("solid-js"),transcript=req("./transcript.cjs");document.head.appendChild(document.createElement("style")).textContent=transcript.css;
  (${scenario})().catch(e=>document.body.dataset.failure=e.message)</script>`);
  const html=execFileSync(process.argv[2],["--headless","--disable-gpu","--no-first-run","--disable-extensions","--virtual-time-budget=3500",
    `--user-data-dir=${path.join(temp,"profile")}`,"--dump-dom",pathToFileURL(file).href],{encoding:"utf8",timeout:30000,stdio:["ignore","pipe","ignore"]});
  if(!html.includes('<body data-result="pass">'))throw Error((html.match(/<body[^>]*>/)?.[0]||"missing document")+" "+(html.match(/<div class="ap-messages">[\s\S]*?<\/footer>/)?.[0]||"").slice(0,3200));
  console.log("PASS: overlay bounds, live text updates, older messages, retry, close/Esc, focus, draft, scrolled sidebar and unchanged route.");
}finally{fs.rmSync(temp,{recursive:true,force:true,maxRetries:4,retryDelay:150})}
