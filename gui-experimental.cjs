"use strict";
const factories={"./tree.cjs":function(require,module,exports){
"use strict";

const outcomes = {succeeded:"Завершил работу", failed:"Ошибка", interrupted:"Остановлен"};
const activities = {read:"Читает файл", glob:"Ищет файлы", grep:"Ищет по файлам",
  shell:"Выполняет команду", patch:"Редактирует файлы", subagent:"Запускает агента",
  websearch:"Ищет в интернете", webfetch:"Читает страницу", question:"Ждёт ответа"};

function toolState(name) {
  return Object.hasOwn(activities, name) ? activities[name] : name ? `Выполняет: ${name}` : "Выполняет инструмент";
}

function executionState(info, running, message) {
  if (!running && info.time?.busy != null && info.time.busy > (info.time.idle ?? -Infinity)) return "Исход неизвестен";
  if (!running) return outcomes[info.outcome] || "Ожидает";
  if (!message || message.time.completed != null || message.time.created < (info.time?.busy ?? 0)) return "Работает";
  const content = message.content || [];
  const tool = content.findLast(part => part.type === "tool" && ["streaming","running"].includes(part.state.status));
  if (tool) return toolState(tool.name);
  return content.at(-1)?.type === "text" ? "Пишет ответ" : "Работает";
}

// Jobs are transient, but successful calls stay in the parent transcript. Only
// completed messages may be checkpoints: an open message can gain more calls.
async function assignments(client,parentID,children,options,cache) {
  if (!children.length) return new Map();
  const prev=cache.get(parentID);
  const found=new Map();
  let cursor,head,done=false;
  do {
    options.signal.throwIfAborted();
    const page=await client.message.list({sessionID:parentID,type:"assistant",limit:12,
      ...(cursor?{cursor}:{order:"desc"})},options);
    for(const msg of page.data){
      if(msg.id && msg.id===prev?.head){done=true;break}
      if(!head && msg.time.completed!=null)head=msg.id;
      for(const p of [...msg.content].reverse()){
        if(p.type!=="tool" || p.name!=="subagent" || p.state.status!=="completed")continue;
        const id=p.state.metadata?.sessionID ?? p.state.input?.sessionID;
        const description=p.state.input?.description;
        if(id && description && !found.has(id))
          found.set(id,{description,started:p.time?.ran ?? p.time?.created ?? msg.time.created});
      }
    }
    cursor=page.cursor?.next;
  } while(cursor && !done && !children.every(c=>found.has(c.id)));
  const byId=new Map([...(prev?.byId || []),...found]);
  cache.set(parentID,{head:head ?? prev?.head,byId});
  return byId;
}

async function loadTree(client, sessionID, signal, history=new Map()) {
  const options = {signal};
  let root = await client.session.get({sessionID}, options);
  const ancestors = new Set([root.id]);
  while (root.parentID && !root.fork && !ancestors.has(root.parentID)) {
    signal.throwIfAborted();
    ancestors.add(root.parentID);
    root = await client.session.get({sessionID:root.parentID}, options);
  }
  const [active, jobs] = await Promise.all([client.session.active(options),
    client.experimental.job.list({sessionID:root.id, descendants:true, kind:"subagent"}, options)]);
  const latest = new Map();
  for (const job of jobs) {
    if (job.kind === "subagent" && (!latest.has(job.childSessionID) ||
        latest.get(job.childSessionID).time.started < job.time.started)) latest.set(job.childSessionID,job);
  }
  const visited = new Set([root.id]);
  const queue = [{info:root, children:[]}];
  const roots = queue[0].children;
  for (let index=0; index<queue.length;) {
    signal.throwIfAborted();
    const batch = queue.slice(index,index+6);
    index += batch.length;
    await Promise.all(batch.map(async ({info,children,assignment}) => {
      const running = active[info.id]?.type === "running";
      const job = latest.get(info.id);
      const [message, descendants] = await Promise.all([
        running ? client.message.list({sessionID:info.id,type:"assistant",limit:1,order:"desc"},options)
          .then(page=>page.data[0]) : undefined,
        listChildren(client, info.id, options),
      ]);
      const task=job && (!assignment || job.time.started >= assignment.started) ? job.description : assignment?.description;
      const tools=running && message && message.time.completed==null && message.time.created >= (info.time?.busy ?? 0)
        ? message.content.filter(p=>p.type==="tool" && ["streaming","running"].includes(p.state.status)).map(p=>[p.id,p.name]) : [];
      const row = {id:info.id, agent:info.agent || job?.agent || (info.id===root.id?"Основной агент":"Агент"),
        task:task || info.title || "", state:executionState(info,running,message), tools, children:[]};
      children.push(row);
      const spawned=descendants.filter(child=>!child.fork && child.parentID===info.id);
      const saved=await assignments(client,info.id,spawned,options,history);
      for (const child of spawned) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        queue.push({info:child, children:row.children, assignment:saved.get(child.id)});
      }
    }));
  }
  // Concurrent requests must not reorder siblings between refreshes.
  const order = new Map(queue.map(({info})=>[info.id,info.time?.created ?? 0]));
  for (const children of new Set(queue.map(item=>item.children)))
    children.sort((a,b)=>order.get(a.id)-order.get(b.id) || a.id.localeCompare(b.id));
  return roots[0];
}

async function listChildren(client, parentID, options) {
  const children = [];
  let cursor;
  do {
    options.signal.throwIfAborted();
    const page = await client.session.list(cursor ? {cursor,limit:100} : {parentID,limit:100}, options);
    children.push(...page.data);
    cursor = page.cursor.next;
  } while (cursor);
  return children;
}

module.exports = {loadTree, executionState, toolState};

},
"./watch.cjs":function(require,module,exports){
"use strict";
const {loadTree, toolState} = require("./tree.cjs");

const states = new Map(Object.entries({
  "session.execution.started":"Работает", "session.step.started":"Работает",
  "session.reasoning.started":"Обдумывает", "session.text.started":"Пишет ответ",
  "session.execution.succeeded":"Завершил работу", "session.execution.failed":"Ошибка",
  "session.execution.interrupted":"Остановлен", "session.retry.scheduled":"Повторяет запрос",
  "permission.asked":"Ждёт разрешения", "form.created":"Ждёт ответа",
  "session.tool.success":"Работает", "session.tool.failed":"Работает",
  "permission.replied":"Работает", "form.replied":"Работает",
}));
const structural = new Set(["session.created","session.deleted","session.renamed","session.agent.selected",
  "session.archived","session.unarchived","experimental.job.updated"]);

function watchTree(server,id,notify,load=loadTree) {
  const history=new Map();
  let tree, error, members=new Map(), tools=new Map(), replay, request, timer, pending=false, disposed=false;
  let online=server.connected!==false;
  const emit=()=>notify({tree,error,empty:!!tree && !tree.children.length && !error && online});
  function schedule() {
    if(!timer && !disposed) timer=setTimeout(()=>{timer=null;void refresh()},300);
  }
  function apply(key,name,d,update) {
    const row=members.get(key);
    if(!row)return;
    const calls=tools.get(key);
    let state=states.get(name);
    if(name==="session.tool.input.started"){
      calls.set(d.id,d.name);state=toolState(d.name);
    } else if(name==="session.tool.success" || name==="session.tool.failed"){
      const isAssignment=calls.get(d.id)==="subagent" || !!d.metadata?.sessionID;
      calls.delete(d.id);
      if(calls.size)state=toolState([...calls.values()].at(-1));
      if(update && isAssignment && name==="session.tool.success")schedule();
    } else if(name.startsWith("session.execution."))calls.clear();
    if(row.state===state)return;
    row.state=state;
    if(update) notify({tree,error,changed:row});
  }
  async function refresh() {
    if(disposed || !online) return;
    if(replay){pending=true;return}
    replay=[];
    const ctrl=new AbortController();request=ctrl;
    try {
      const next=await load(server.client,id,ctrl.signal,history);
      if(ctrl.signal.aborted) return;
      tree=next; members=new Map();tools=new Map();
      const todo=[tree];
      while(todo.length){const row=todo.pop();members.set(row.id,row);tools.set(row.id,new Map(row.tools));todo.push(...row.children)}
      for(const [key,name,d] of replay) apply(key,name,d,false);
      error=null;emit();
    } catch(e) {
      if(!ctrl.signal.aborted){error=e;emit()}
    } finally {
      replay=null;request=null;
      if(pending){pending=false;schedule()}
    }
  }
  const off=server.data.listen(({name,details})=>{
    if(!online)return;
    if(name==="server.connected"){schedule();return}
    if(!states.has(name) && !structural.has(name) && name!=="session.tool.input.started") return;
    const d=details.data, key=d.sessionID ?? d.form?.sessionID ?? d.info?.sessionID;
    if(structural.has(name)){
      if(name==="experimental.job.updated" && d.info?.kind!=="subagent") return;
      if(key===id || members.has(key) || members.has(d.parentID) || (!tree && replay)) schedule();
      return;
    }
    if(!key || (!replay && !members.has(key))) return;
    const event={id:d.id,name:d.name,metadata:{sessionID:d.metadata?.sessionID}};
    if(replay)replay.push([key,name,event]);
    apply(key,name,event,true);
  });
  // Recover missed events and failed snapshots even after a quiet reconnect.
  const interval=setInterval(schedule,60000);
  if(!online)error=new Error("offline");
  emit();void refresh();
  return {refresh,connection(connected){
    if(disposed || online===connected)return;
    online=connected;
    if(!online){request?.abort();error=new Error("offline");emit()}
    else void refresh();
  },close(){
    if(disposed) return;
    disposed=true; request?.abort();off();clearTimeout(timer);clearInterval(interval);
  }};
}
module.exports={watchTree};

},
"./cards.cjs":function(require,module,exports){
"use strict";
const roles=new Map([["general","Универсальный агент"],["explore","Исследователь"],["build","Исполнитель"],["plan","Планировщик"]]);
const marks=new Map([["Завершил работу","done"],["Ошибка","error"],["Остановлен","stopped"],["Исход неизвестен","unknown"],
  ["Ожидает","idle"],["Ждёт разрешения","wait"],["Ждёт ответа","wait"],["Повторяет запрос","retry"]]);
const appearance=state=>marks.get(state)||"work";

function cardMap(row,root=true){
  const title=root?"Основной агент":row.task||"Поручение без названия";
  const role=root?"Ведёт беседу":roles.get(row.agent)||(row.agent?`Роль: ${row.agent}`:"Субагент");
  const card={id:row.id,title,role,state:row.state,mark:appearance(row.state),count:0,visible:[],finished:[]};
  for(const child of row.children){
    const branch=cardMap(child,false);
    card.count+=1+branch.count;
    (branch.mark==="done" && !branch.visible.length?card.finished:card.visible).push(branch);
  }
  return card;
}
module.exports={cardMap,appearance};

},
"./card-view.cjs":function(require,module,exports){
"use strict";
const {cardMap,appearance}=require("./cards.cjs");
const css=`
.oc-agent-tree{box-sizing:border-box;height:100%;min-width:0;overflow:auto;padding:12px;color:var(--v2-text-text-base,CanvasText);font:inherit}
.oc-agent-tree .at-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.oc-agent-tree h2{margin:0;font-size:14px;font-weight:600}
.oc-agent-tree :is(.at-count,.at-role,.at-note,.at-empty,summary){font-size:12px;color:var(--v2-text-text-muted,GrayText)}
.oc-agent-tree .at-count{font-variant-numeric:tabular-nums}
.oc-agent-tree ul{list-style:none;margin:0;padding:0}
.oc-agent-tree li{min-width:0}
.oc-agent-tree .at-card{box-sizing:border-box;min-width:0;display:grid;justify-items:start;gap:3px;margin:6px 0;padding:8px 10px;overflow-wrap:anywhere;
 background:var(--v2-background-bg-layer-01,Canvas);border:1px solid var(--v2-border-base,color-mix(in srgb,currentColor 21%,transparent));border-inline-start:4px solid var(--at-ac);border-radius:7px}
.oc-agent-tree .at-title{font-size:14px;font-weight:600;line-height:1.38}
.oc-agent-tree button.at-card{width:100%;font:inherit;text-align:start;color:inherit;text-decoration:none;cursor:pointer}
.oc-agent-tree button.at-card:hover{background:var(--v2-overlay-simple-overlay-hover,color-mix(in srgb,currentColor 8%,transparent))}
.oc-agent-tree button.at-card:focus-visible{outline:2px solid var(--at-ac,currentColor);outline-offset:1px}
.oc-agent-tree .at-role{line-height:1.35}
.oc-agent-tree .at-state{display:inline-flex;align-items:center;gap:5px;max-width:100%;margin-top:3px;padding:2px 6px;border-radius:5px;font-size:12px;line-height:1.4;font-weight:600;
 background:color-mix(in srgb,var(--at-ac) 14%,transparent);color:var(--v2-text-text-base,CanvasText)}
.oc-agent-tree .at-state svg{width:14px;height:14px;flex:none;stroke:var(--at-ac);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.oc-agent-tree [data-mark=work]{--at-ac:light-dark(#2368a5,#80c5ff)}
.oc-agent-tree :is([data-mark=wait],[data-mark=retry]){--at-ac:light-dark(#946014,#ffd084)}
.oc-agent-tree [data-mark=done]{--at-ac:light-dark(#377343,#8ed8a2)}
.oc-agent-tree [data-mark=error]{--at-ac:light-dark(#a23332,#ff9d9a)}
.oc-agent-tree :is([data-mark=idle],[data-mark=unknown],[data-mark=stopped]){--at-ac:light-dark(#655c76,#b8b5ca)}
.oc-agent-tree .at-limb{--at-indent:clamp(6px,1vw,12px);margin-inline-start:5px;padding-inline-start:var(--at-indent);border-inline-start:1px solid var(--v2-border-base,GrayText)}
.oc-agent-tree .at-limb>li{position:relative}
.oc-agent-tree .at-limb>li:before{content:"";position:absolute;inset-inline-start:calc(-1 * var(--at-indent));top:14px;width:var(--at-indent);border-top:1px solid var(--v2-border-base,GrayText)}
.oc-agent-tree details{margin:6px 0}
.oc-agent-tree summary{cursor:pointer;display:list-item;width:fit-content;padding:4px 6px;border-radius:4px;user-select:none}
.oc-agent-tree summary:hover{background:var(--v2-overlay-simple-overlay-hover,color-mix(in srgb,currentColor 10%,transparent))}
.oc-agent-tree summary:focus-visible,.oc-agent-tree button:focus-visible{outline:2px solid currentColor;outline-offset:1px}
.oc-agent-tree .at-empty{padding:8px 10px;margin:8px 0;border:1px dashed var(--v2-border-base,GrayText);border-radius:6px}
.oc-agent-tree .at-note:not(:empty){margin:6px 0}
.oc-agent-tree .at-note button{cursor:pointer;text-decoration:underline;margin-inline-start:6px}
`;
const shapes={
  work:"M12 3a9 9 0 1 1-8.5 6 M3 4l.5 5 5-.5",
  wait:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
  done:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M7.5 12l3 3 6-6",
  error:"M12 3l10 17H2z M12 9v4 M12 16h.01",
  stopped:"M8 3h8l5 5v8l-5 5H8l-5-5V8z M9 9h6v6H9z",
  idle:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M10 9v6 M14 9v6",
  unknown:"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M9 9a3 3 0 1 1 5 2.2c-1 .6-2 1.2-2 2.8 M12 17h.01",
  retry:"M4 7v5h5 M4.5 11a8 8 0 1 1 2 6",
};
function el(tag,cls,text){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text)n.textContent=text;
  return n;
}
function applyBadge(nodes,state){
  const mark=appearance(state);
  nodes.card.dataset.mark=mark;
  nodes.path.setAttribute("d",shapes[mark]);
  nodes.text.textContent=state;
}
function createCardView(branch,count,preview){
  const opened=new Set(),summaries=new Map(),nodes=new Map();
  let lastEmpty=false;
  function display(tree,empty){
    const active=document.activeElement;
    const focus=branch.contains(active)?active?.dataset.historyFor:undefined;
    const focusedCard=branch.contains(active)?active?.dataset.sessionId:undefined;
    for(const [id,summary] of summaries){
      if(summary.parentElement.open)opened.add(id);else opened.delete(id);
    }
    summaries.clear();nodes.clear();
    function item(row){
      const li=el("li"),card=el("button","at-card"),badge=el("span","at-state");
      card.type="button";
      card.setAttribute("aria-haspopup","dialog");
      card.onclick=()=>preview(row,card);
      card.dataset.sessionId=row.id;
      card.title=`Открыть диалог: ${row.title}`;
      const svg=document.createElementNS("http://www.w3.org/2000/svg","svg"),path=document.createElementNS(svg.namespaceURI,"path");
      svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.append(path);
      const text=el("span");badge.append(svg,text);
      const parts={card,path,text};
      nodes.set(row.id,parts);applyBadge(parts,row.state);
      card.append(el("strong","at-title",row.title),el("span","at-role",row.role),badge);li.append(card);
      if(row.visible.length || row.finished.length){
        const limb=el("ul","at-limb");li.append(limb);
        for(const child of row.visible)limb.append(item(child));
        if(row.finished.length){
          const entry=el("li"),fold=el("details"),summary=el("summary","",`Завершённые · ${row.finished.length}`),list=el("ul");
          summary.dataset.historyFor=row.id;summaries.set(row.id,summary);fold.open=opened.has(row.id);
          for(const child of row.finished)list.append(item(child));
          fold.append(summary,list);entry.append(fold);limb.append(entry);
        }
      }
      return li;
    }
    if(!tree){branch.replaceChildren();count.textContent="";return}
    const map=cardMap(tree),root=item(map);
    count.textContent=`Субагенты: ${map.count}`;
    if(empty && !map.count)root.append(el("p","at-empty","Субагенты в этой беседе не запускались."));
    branch.replaceChildren(root);
    if(focus)summaries.get(focus)?.focus({preventScroll:true});
    if(focusedCard){
      const card=nodes.get(focusedCard)?.card;
      const closed=card?.closest("details:not([open])");
      (closed?.querySelector("summary")??card)?.focus({preventScroll:true});
    }
  }
  return ({tree,empty,changed})=>{
    if(!changed)lastEmpty=empty;
    const node=changed && nodes.get(changed.id);
    if(node && (node.card.dataset.mark==="done")===(appearance(changed.state)==="done")){
      applyBadge(node,changed.state);return;
    }
    display(tree,lastEmpty);
  };
}
module.exports={createCardView,css,el};

},
"./timeline.cjs":function(require,module,exports){
"use strict";
const {createComponent,createEffect,createSignal,For,Show,onCleanup,onMount}=require("solid-js");
const {insert}=require("solid-js/web");
const {el}=require("./card-view.cjs");

// These DOM slots are the styling contract used by Desktop 2.3.2's message-part.css.
// Only the overlay geometry and the space between rows are owned by the plugin.
function part(tag,component,slot){
  const n=el(tag);if(component)n.dataset.component=component;if(slot)n.dataset.slot=slot;return n;
}
function toolName(name){
  const names={read:"Чтение",shell:"Оболочка",glob:"Glob",grep:"Grep",patch:"Патч",skill:"Навык",execute:"Выполнить",
    websearch:"Веб-поиск",webfetch:"Webfetch",subagent:"Субагент",question:"Вопрос"};
  return Object.hasOwn(names,name)?names[name]:name;
}
function textOf(v){return typeof v==="string"?v:""}
function rows(messages){
  const result=new Map();let group;
  const add=(id,kind,m,p)=>{group=undefined;result.set(id,{kind,m,p})};
  for(const m of messages){
    if(m.type==="user"||m.type==="shell"){add(m.id,m.type,m);continue}
    if(m.type!=="assistant"){if(m.type==="idle")group=undefined;continue}
    for(const [i,p] of m.content.entries()){
      const id=`${m.id}:${p.id||i}`;
      if(p.type==="text"&&p.text){add(id,"text",m,p);continue}
      if(p.type!=="tool"&&p.type!=="reasoning")continue;
      if(!group){group={kind:"activity",items:new Map()};result.set(id+":activity",group)}
      group.items.set(id,p);
    }
    if(m.error)add(m.id+":error","error",m);
  }
  return result;
}
function icon(ui,name){return createComponent(ui.Icon,{name,size:"small"})}
function user(get){
  const root=part("div","user-message"),body=part("div",null,"user-message-body"),bubble=part("div",null,"user-message-text");
  const fold=part("div",null,"user-message-fold"),text=el("div"),toggle=part("button",null,"user-message-fold-toggle");
  bubble.dir="auto";toggle.type="button";let expanded=false,large=false;
  function size(){
    const line=parseFloat(getComputedStyle(text).lineHeight)||20;
    large=text.scrollHeight>line*12+1;
    fold.style.maxHeight=large&&!expanded?`${line*8}px`:"";
    fold.toggleAttribute("data-folded",large&&!expanded);toggle.hidden=!large;
    toggle.textContent=expanded?"Свернуть":"Читать далее";toggle.setAttribute("aria-expanded",String(expanded));
  }
  toggle.onclick=()=>{expanded=!expanded;size()};
  insert(text,()=>get().m.text);
  fold.append(text);bubble.append(fold,toggle);body.append(bubble);
  const attachments=part("div",null,"user-message-attachments");
  insert(attachments,()=>get().m.files?.map(f=>{const file=part("span",null,"user-message-attachment");file.dataset.type="file";file.textContent=f.filename||f.mime||"Файл";return file}));
  insert(root,()=>get().m.files?.length?attachments:null,null);root.append(body);
  const obs=new ResizeObserver(size);onMount(()=>{obs.observe(text);size()});onCleanup(()=>obs.disconnect());
  return root;
}
function answer(get,ui,copy){
  const root=part("div","text-part"),body=part("div",null,"text-part-body"),meta=part("div",null,"text-part-copy-wrapper");
  insert(body,createComponent(ui.Markdown,{get text(){return get().p.text}}));
  const [copied,setCopied]=createSignal(false);let timer;
  onCleanup(()=>clearTimeout(timer));
  insert(meta,createComponent(ui.IconButton,{get icon(){return copied()?"check":"copy"},get label(){return copied()?"Скопировано":"Копировать ответ"},size:"small",variant:"ghost",
    onClick:async()=>{try{await copy(get().p.text);setCopied(true);clearTimeout(timer);timer=setTimeout(()=>setCopied(false),1200)}catch{setCopied(false)}}}));
  const labels=part("span",null,"text-part-meta");
  insert(labels,()=>{const m=get().m;return [m.agent,m.model?.id,m.model?.variant==="default"?"":m.model?.variant].filter(Boolean).join(" · ")});
  meta.append(labels);root.append(body,meta);return root;
}
function activity(get,ui){
  const group=part("div","collapsed-tool-group"),wrap=part("div","collapsible"),toggle=part("button",null,"collapsible-trigger");
  const trigger=part("span","context-tool-group-trigger"),title=part("span",null,"context-tool-group-title"),usage=part("span",null,"context-tool-group-usage");
  wrap.className="tool-collapsible";toggle.type="button";const [open,setOpen]=createSignal(false);
  toggle.onclick=()=>setOpen(!open());createEffect(()=>toggle.setAttribute("aria-expanded",String(open())));
  insert(usage,()=>{const entries=[...get().items.values()],tools=entries.filter(p=>p.type==="tool");
    const names=[...new Set(tools.map(p=>toolName(p.name)))];
    return tools.length?`Использовано ${tools.length} ${names.slice(0,4).join(", ")}${names.length>4?"…":""}`:"Размышление"});
  title.append(usage);trigger.append(title);insert(trigger,()=>icon(ui,open()?"chevron-down":"chevron-right"),null);
  toggle.append(trigger);wrap.append(toggle);group.append(wrap);
  insert(wrap,createComponent(Show,{get when(){return open()},get children(){
    const rail=part("div",null,"collapsible-content"),list=part("div","context-tool-group-list");
    insert(list,createComponent(For,{get each(){return [...get().items.keys()]},children:key=>{
      const p=()=>get().items.get(key),wrap=part("div",null,"context-tool-group-item"),details=el("details"),summary=el("summary"),hint=el("span","ap-tool-hint");
      insert(summary,()=>p().type==="tool"?toolName(p().name):"Размышление",null);
      insert(hint,()=>{const input=p().state?.input||{};return textOf(input.command)||textOf(input.path)||textOf(input.filePath)||textOf(input.pattern)||textOf(input.description)||textOf(input.id)});
      summary.append(hint);details.append(summary);wrap.append(details);
      const [expanded,setExpanded]=createSignal(false);details.ontoggle=()=>setExpanded(details.open);
      insert(details,createComponent(Show,{get when(){return expanded()},get children(){
        const pre=el("pre","ap-tool-output");
        insert(pre,()=>{const state=p().state;if(!state)return "Размышление агента";
          return [state.input && JSON.stringify(state.input,null,2),...(state.content||[]).map(c=>c.type==="text"?c.text:"[Файл]"),state.error?.message].filter(Boolean).join("\n")});
        return pre;
      }}),null);return wrap;
    }}));rail.append(list);return rail;
  }}),null);return group;
}
function timeline(projection,ui,copy){
  return createComponent(For,{get each(){return [...projection().keys()]},children:id=>{
    const get=()=>projection().get(id);
    switch(get().kind){
      case "user":return user(get);
      case "text":return answer(get,ui,copy);
      case "activity":return activity(get,ui);
      default:{const pre=el("pre","ap-tool-output");insert(pre,()=>get().kind==="error"?get().m.error.message:[get().m.command,get().m.output].filter(Boolean).join("\n"));return pre}
    }
  }});
}
module.exports={timeline,rows,icon};

},
"./context-ring.cjs":function(require,module,exports){
"use strict";
const {createEffect,createMemo,untrack}=require("solid-js");
const {el}=require("./card-view.cjs");

const number=new Intl.NumberFormat("ru-RU");
function contextRing(server,id,lastAssistantWithUsage){
  const data=server.data,info=()=>data.session.get(id);
  const measured=createMemo(()=>lastAssistantWithUsage(data.session.message.list(id),info()?.revert?.messageID));
  const directory=createMemo(()=>info()?.location?.directory);
  // Historical children can live in a location whose model catalog was never opened.
  createEffect(()=>{
    const dir=directory();
    if(dir && server.connected!==false)untrack(()=>{void data.location.model.sync?.({directory:dir}).catch(()=>{})});
  });
  const meter=el("span","ap-context"),value=el("span");
  meter.setAttribute("role","img");
  const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
  svg.setAttribute("viewBox","0 0 14 14");svg.setAttribute("width","14");svg.setAttribute("height","14");
  svg.setAttribute("fill","none");svg.setAttribute("aria-hidden","true");
  svg.dataset.component="progress-circle";svg.dataset.appearance="compact";
  function circle(slot){
    const c=document.createElementNS(ns,"circle");c.dataset.slot=slot;
    c.setAttribute("cx","7");c.setAttribute("cy","7");c.setAttribute("r","6.25");c.setAttribute("stroke-width","1.5");
    svg.append(c);return c;
  }
  circle("progress-circle-background");
  const arc=circle("progress-circle-progress");arc.setAttribute("pathLength","100");arc.setAttribute("stroke-dasharray","100");
  meter.append(svg,value);
  createEffect(()=>{
    const step=measured(),t=step?.tokens,ref=step?.model,loc=info()?.location;
    const used=t?t.input+t.output+t.reasoning+t.cache.read+t.cache.write:null;
    const limit=ref&&loc?data.location.model.list(loc)?.findLast(m=>m.providerID===ref.providerID&&m.id===ref.id&&m.status!=="deprecated")?.limit?.context:null;
    const percent=used!==null && Number.isFinite(limit) && limit>0?100*used/limit:null;
    const count=used===null?"—":number.format(used);
    value.textContent=used===null?"Контекст: —":`${count} ток.${percent===null?"":` · ${Math.round(percent)}%`}`;
    svg.toggleAttribute("hidden",percent===null);
    if(percent!==null)arc.setAttribute("stroke-dashoffset",String(100-Math.min(100,Math.max(0,percent))));
    const label=used===null?"Контекст: пока нет измерения":percent===null?`Контекст: ${count} токенов. Лимит модели неизвестен.`:
      `Контекст: ${count} из ${number.format(limit)} токенов (${Math.round(percent)}%)`;
    meter.title=label;meter.setAttribute("aria-label",label);
  });
  return meter;
}
module.exports={contextRing};

},
"./transcript.cjs":function(require,module,exports){
"use strict";
const {createRoot,getOwner,createEffect,createMemo,createSignal,createComponent,onCleanup,untrack}=require("solid-js");
const {insert}=require("solid-js/web");
const {el}=require("./card-view.cjs");
const {timeline,rows,icon}=require("./timeline.cjs");
const {contextRing}=require("./context-ring.cjs");

const css=`
.oc-agent-preview-layer{position:fixed;inset:auto;box-sizing:border-box;max-width:none;max-height:none;margin:0;border:0;background:transparent;pointer-events:none;padding:clamp(10px,1.7vmin,24px);display:grid;min-width:0;min-height:0;overflow:visible}
.oc-agent-preview-layer::backdrop{background:transparent;pointer-events:none}
.oc-agent-preview[open]{pointer-events:auto;position:relative;inset:auto;display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;max-height:100%;max-width:100%;min-height:0;min-width:0;margin:0;padding:0;overflow:hidden;
 border:1px solid var(--v2-border-border-base,GrayText);border-radius:var(--radius-lg,10px);box-shadow:0 9px 32px #0003,0 1px 4px #0002;
 background:var(--v2-background-bg-base,Canvas);color:var(--v2-text-text-base,CanvasText);font-family:var(--v2-font-family-sans,inherit)}
.oc-agent-preview .ap-head{flex:none;display:flex;min-height:44px;align-items:center;gap:6px;padding:0 12px;
 font:440 13px/16px var(--v2-font-family-sans,system-ui);letter-spacing:-.04px}
.oc-agent-preview .ap-head :is(.ap-project,.ap-parent,h2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oc-agent-preview .ap-head :is(.ap-project,.ap-parent){max-width:25%;color:var(--v2-text-text-muted,GrayText)}
.oc-agent-preview .ap-slash{color:var(--v2-text-text-faint,GrayText)}
.oc-agent-preview .ap-head h2{min-width:0;margin:0;font:inherit;font-weight:530;flex:1}
.oc-agent-preview .ap-notice,.oc-agent-preview .ap-aux{font-size:12px;color:var(--v2-text-text-muted,GrayText)}
.oc-agent-preview .ap-aux{cursor:pointer;padding:4px 0}
.oc-agent-preview [hidden]{display:none!important}
.oc-agent-preview button:focus-visible,.oc-agent-preview summary:focus-visible{outline:2px solid currentColor;outline-offset:1px}
.oc-agent-preview .ap-close{flex:none}
.oc-agent-preview .ap-feed{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;overflow-anchor:none;scrollbar-width:thin;container-type:inline-size}
.oc-agent-preview .ap-column{box-sizing:border-box;width:100%;margin-inline:auto;max-width:var(--ap-max-width,var(--container-session,100%));padding:12px 24px 24px}
@container(max-width:560px){.oc-agent-preview .ap-column{padding-inline:16px}}
.oc-agent-preview .ap-messages{min-width:0}
.oc-agent-preview .ap-messages>[data-component="user-message"]:not(:first-child){margin-block-start:28px}
.oc-agent-preview .ap-messages>[data-component="collapsed-tool-group"]{margin-block-start:16px}
.oc-agent-preview [data-component="context-tool-group-trigger"]{cursor:pointer;gap:4px}
.oc-agent-preview [data-component="context-tool-group-trigger"]>[data-component]{color:var(--v2-text-text-faint,GrayText);flex:none}
.oc-agent-preview .ap-tool-hint{color:var(--v2-text-text-faint,GrayText);margin-inline-start:6px}
.oc-agent-preview [data-slot="context-tool-group-item"] summary{cursor:pointer;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;font:440 13px/24px var(--v2-font-family-sans,system-ui)}
.oc-agent-preview .ap-tool-output{margin:4px 0 10px;padding:8px 12px;max-height:280px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;
 background:var(--v2-background-bg-layer-01,Canvas);border-radius:6px;font:12px/18px var(--v2-font-family-mono,monospace)}
.oc-agent-preview .ap-foot{flex:none;min-width:0;display:flex;align-items:center;gap:8px;height:32px;padding:0 8px 0 12px;
 font:440 12px/16px var(--v2-font-family-sans,system-ui);color:var(--v2-text-text-faint,GrayText)}
.oc-agent-preview .ap-foot-label{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.oc-agent-preview .ap-context{flex:none;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--v2-text-text-muted,GrayText)}
.oc-agent-preview{container-type:inline-size}
@container(max-width:480px){.oc-agent-preview .ap-back-label{display:none}}
.oc-agent-preview .ap-return{flex:none;display:inline-flex;align-items:center;gap:6px;cursor:pointer}
`;

// Own only this preview. The main timeline, composer and sidebar never change route or owner.
function createPreview(ui,copy,lastAssistantWithUsage){
  // Callbacks run outside Solid. Markdown needs the owning Desktop window's providers.
  const owner=getOwner();
  let current;
  function close(restore=true){current?.(restore)}
  function open(server,row,trigger){
    const host=trigger.closest("[data-pane-row]")?.querySelector('[data-slot="session-chat-panel"]');
    if(!host)return false;
    close(false);
    createRoot(dispose=>{
      const layer=el("div","oc-agent-preview-layer"),dialog=el("dialog","oc-agent-preview");
      const reference=host.querySelector("[data-timeline-row]");
      if(reference)dialog.style.setProperty("--ap-max-width",getComputedStyle(reference).maxWidth);
      const sessions=server.data.session,id=row.id,info=()=>sessions.get(id);
      const header=el("header","ap-head"),heading=el("h2","",row.title);
      heading.title=row.title;
      for(const [cls,read] of [["ap-project",()=>info()?.location?.directory?.split(/[\\/]/).filter(Boolean).at(-1)],
        ["ap-parent",()=>info()?.parentID && sessions.get(info().parentID)?.title]]){
        const label=el("span",cls),slash=el("span","ap-slash","/");slash.setAttribute("aria-hidden","true");
        createEffect(()=>{const text=read();label.hidden=slash.hidden=!text;label.title=label.textContent=text||""});
        header.append(label,slash);
      }
      dialog.setAttribute("aria-label",`Диалог агента: ${row.title}`);
      header.append(heading);
      insert(header,createComponent(ui.IconButton,{class:"ap-close",icon:"close",size:"small",variant:"ghost-muted",label:"Закрыть диалог агента",onClick:()=>finish(true)}));
      const feed=el("div","ap-feed"),column=el("div","ap-column"),more=el("button","ap-aux","Показать предыдущие сообщения"),notice=el("div","ap-notice"),retry=el("button","ap-aux","Повторить"),messages=el("div","ap-messages");
      more.type=retry.type="button";notice.setAttribute("role","status");feed.tabIndex=0;
      const foot=el("footer","ap-foot"),caption=el("span","ap-foot-label"),back=el("button","ap-return"),backLabel="Вернуться к основной сессии";
      back.type="button";back.onclick=()=>finish(true);back.setAttribute("aria-label",backLabel);back.append(el("span","ap-back-label",backLabel));
      insert(back,createComponent(ui.Keybind,{keys:["Esc"],variant:"neutral"}));
      const running=()=>sessions.status(id)==="running";
      const [now,setNow]=createSignal(Date.now());
      createEffect(()=>{if(running()){setNow(Date.now());const t=setInterval(()=>setNow(Date.now()),1000);onCleanup(()=>clearInterval(t))}});
      const last=()=>sessions.message.list(id).findLast(m=>m.type==="assistant");
      const outcome=()=>{const i=info();return running()?"running":(i?.time?.busy??0)>(i?.time?.idle??0)?"unknown":i?.outcome};
      insert(foot,()=>icon(ui,{running:"status",succeeded:"check",failed:"close",interrupted:"close"}[outcome()]||"status"),null);
      insert(caption,()=>{
        const i=info(),model=i?.model||last()?.model;
        const label={running:"Выполняется",succeeded:"Готово",failed:"Ошибка",interrupted:"Прервано",unknown:"Исход неизвестен"}[outcome()]||"Ожидает";
        const start=i?.time?.busy??i?.time?.created,end=running()?now():i?.time?.idle;
        const secs=start!=null && end>=start?Math.floor((end-start)/1000):undefined;
        const duration=secs===undefined?"":secs<60?`${secs} с`:`${Math.floor(secs/60)} мин ${secs%60} с`;
        const agent=i?.agent||last()?.agent,modelName=model&&i?.location&&server.data.location?.model?.list(i.location)?.find(m=>m.id===model.id&&m.providerID===model.providerID)?.name;
        return [label,duration,agent && (agent[0].toUpperCase()+agent.slice(1)),[model?.providerID,modelName||model?.id].filter(Boolean).join(" / "),model?.variant==="default"?"":model?.variant].filter(Boolean).join("  ·  ");
      });
      foot.append(caption,contextRing(server,id,lastAssistantWithUsage),back);
      column.append(more,notice,retry,messages);feed.append(column);dialog.append(header,feed,foot);layer.append(dialog);
      // The composer is portalled above the chat's stacking context. Top layer, not a larger z-index.
      layer.popover="manual";host.append(layer);
      const align=()=>{const r=host.getBoundingClientRect();Object.assign(layer.style,{left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px"})};
      align();layer.showPopover();dialog.show();header.querySelector("button")?.focus({preventScroll:true});
      const geometry=new ResizeObserver(align);geometry.observe(host);window.addEventListener("resize",align);
      onCleanup(()=>{geometry.disconnect();window.removeEventListener("resize",align)});
      const branch=trigger.closest(".oc-agent-tree"),ctrl=new AbortController();
      const finish=restore=>{
        current=null;dispose();
        if(restore){
          const focus=trigger.isConnected?trigger:branch?.querySelector(`[data-session-id="${CSS.escape(row.id)}"]`);
          focus?.focus({preventScroll:true});
        }
      };
      current=finish;
      const key=e=>{
        if(e.key!=="Escape" || e.isComposing || document.querySelector("dialog:modal"))return;
        e.preventDefault();e.stopImmediatePropagation();finish(true);
      };
      window.addEventListener("keydown",key,true);
      let stick=true,frame=0,loadingOld=false;
      feed.onscroll=()=>{stick=feed.scrollHeight-feed.scrollTop-feed.clientHeight<36};
      const observer=new ResizeObserver(()=>{
        if(stick && !loadingOld){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(stick && !loadingOld)feed.scrollTop=feed.scrollHeight})}
      });
      observer.observe(messages);
      onCleanup(()=>{ctrl.abort();window.removeEventListener("keydown",key,true);observer.disconnect();cancelAnimationFrame(frame);dialog.close();layer.remove()});
      const store=sessions.message;
      const [loading,setLoading]=createSignal(true),[error,setError]=createSignal("");
      async function sync(){
        setLoading(true);setError("");
        try{await store.sync(id)}catch{if(!ctrl.signal.aborted)setError("Не удалось загрузить переписку.")}
        finally{if(!ctrl.signal.aborted)setLoading(false)}
      }
      async function older(){
        if(loadingOld)return;
        loadingOld=true;setError("");
        let top=0,h=0;
        try{
          await store.loadMore(id,{signal:ctrl.signal,beforePublish:()=>{top=feed.scrollTop;h=feed.scrollHeight}});
          if(!ctrl.signal.aborted && h){feed.scrollTop=top+feed.scrollHeight-h;stick=false}
        }catch{if(!ctrl.signal.aborted)setError("Не удалось загрузить предыдущие сообщения.")}
        finally{loadingOld=false}
      }
      let disconnected=false;
      createEffect(()=>{
        if(server.connected===false){disconnected=true;return}
        if(disconnected){store.invalidate(id);disconnected=false}
        untrack(()=>{void sessions.sync?.(id).catch(()=>{});void sync()});
      });
      more.onclick=older;retry.onclick=()=>error().includes("предыдущие")?older():sync();
      const projection=createMemo(()=>rows(store.list(id)));
      insert(messages,timeline(projection,ui,copy));
      createEffect(()=>{
        more.hidden=!store.more(id);more.disabled=store.loading(id)||server.connected===false;
        retry.hidden=!error()||server.connected===false;
        notice.textContent=server.connected===false?"Нет связи. Показана загруженная переписка.":error()||
          (projection().size?"":loading()?"Загрузка переписки…":"Сообщений пока нет.");
      });
    },owner);
    return true;
  }
  return {open,close};
}
module.exports={createPreview,css};

},
"./gui.cjs":function(require,module,exports){
"use strict";
const {Plugin, Panel, MenuItem, Style}=require("@opencode/plugin/gui");
const {createEffect,onCleanup,untrack}=require("solid-js");
const {lastAssistantWithUsage}=require("@opencode/client/solid");
const {watchTree}=require("./watch.cjs");

const {createCardView,css,el}=require("./card-view.cjs");
const {createPreview,css:previewCss}=require("./transcript.cjs");
function panel(props,ctx){
  const box=el("section","oc-agent-tree");
  box.setAttribute("aria-label","Дерево агентов");
  const header=el("div","at-head"),count=el("span","at-count");
  header.append(el("h2","","Агенты беседы"),count);box.append(header);
  const note=el("div","at-note"), branch=el("ul");
  note.setAttribute("role","status");
  box.append(note,branch);
  createEffect(()=>{
    const session=props.session, id=session.id, server=session.server,preview=createPreview(ctx.ui,text=>ctx.system.copy(text),lastAssistantWithUsage);
    onCleanup(()=>preview.close(false));
    const render=createCardView(branch,count,(row,trigger)=>{
      if(!preview.open(server,row,trigger))ctx.toast.show({title:"Область чата недоступна"});
    });
    const view=untrack(()=>watchTree(server,id,update=>{
      render(update);
      if(update.changed)return;
      const {tree,error}=update;
      note.replaceChildren();
      if(error){
        note.textContent=tree?"Не удалось обновить дерево. Показаны последние данные.":"Не удалось загрузить дерево.";
        const retry=el("button","","Повторить");retry.type="button";retry.onclick=()=>view.refresh();note.append(retry);
      } else if(!tree)note.textContent="Загрузка дерева…";
    }));
    createEffect(()=>view.connection(server.connected!==false));
    onCleanup(()=>view.close());
  });
  return box;
}
exports.default=Plugin.define({
  setup(ctx){
    if(ctx.app.platform!=="desktop")return;
    const tab={id:"tree",title:"Агенты",closable:"compact",fallback:true,tabbable:true};
    const key=`${ctx.id}:tree`;
    ctx.add(Style,css+previewCss);
    ctx.add(Panel,{id:"tree",region:"side",width:"narrow",
      list:({open})=>open.includes(tab.id)?[tab]:[], render:props=>panel(props,ctx)});
    ctx.add(MenuItem,()=>{
      const s=ctx.sessions.current();
      if(s)return {menu:"session.panel",id:"show-tree",title:"Агенты",icon:"file-tree",order:0,
        opened:ctx.layout.state(key,s)!=="closed",run:()=>ctx.layout.open(key,s)};
    });
  }
});

}};
const cache=new Map();
function load(id){if(!Object.hasOwn(factories,id))return require(id);if(!cache.has(id)){const m={exports:{}};cache.set(id,m);factories[id](load,m,m.exports)}return cache.get(id).exports}
exports.default=load("./gui.cjs").default;
