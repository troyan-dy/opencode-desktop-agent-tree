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
