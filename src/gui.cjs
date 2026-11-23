"use strict";
const {Plugin, Panel, MenuItem, Style}=require("@opencode/plugin/gui");
const {createEffect,onCleanup,untrack}=require("solid-js");
const {watchTree}=require("./watch.cjs");

const css=`
.oc-agent-tree{box-sizing:border-box;height:100%;overflow:auto;padding:12px 14px;color:var(--v2-text-text-base);font:inherit}
.oc-agent-tree h2{font-size:14px;font-weight:600;margin:0 0 12px}
.oc-agent-tree ul{list-style:none;margin:0;padding:0}
.oc-agent-tree ul ul{margin-inline-start:6px;padding-inline-start:12px;border-inline-start:1px solid var(--v2-border-base,currentColor)}
.oc-agent-tree li{padding:4px 0;min-width:0}
.oc-agent-tree .at-person,.oc-agent-tree .at-task{display:block;overflow-wrap:anywhere}
.oc-agent-tree .at-person{font-weight:600}
.oc-agent-tree .at-task,.oc-agent-tree .at-note{color:var(--v2-text-text-muted);font-size:12px}
.oc-agent-tree .at-state{font-size:12px;display:block;color:var(--v2-text-text-muted)}
.oc-agent-tree .at-state:before{content:'●';font-size:8px;margin-inline-end:6px;color:var(--at-tone,currentColor)}
.oc-agent-tree [data-tone=busy]{--at-tone:#579eef}
.oc-agent-tree [data-tone=done]{--at-tone:#579768}
.oc-agent-tree [data-tone=error]{--at-tone:#d46c62}
.oc-agent-tree button{cursor:pointer;text-decoration:underline;margin-inline-start:6px}
`;
function el(tag,cls,text){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(text)n.textContent=text;
  return n;
}
function status(node,label){
  node.textContent=label;
  node.dataset.tone=label==="Ошибка"?"error":label==="Завершил работу"?"done":
    ["Ожидает","Остановлен"].includes(label)?"idle":"busy";
}
function panel(props){
  const box=el("section","oc-agent-tree");
  box.setAttribute("aria-label","Дерево агентов");
  box.append(el("h2","","Агенты"));
  const note=el("div","at-note"), branch=el("ul");
  note.setAttribute("role","status");
  box.append(note,branch);
  createEffect(()=>{
    const session=props.session, id=session.id, server=session.server;
    let view; const labels=new Map();
    function item(row,root,empty){
      const li=el("li"), name=el("div","at-person",root?`Основной агент · ${row.agent}`:row.agent);
      const state=el("span","at-state");status(state,row.state);labels.set(row.id,state);
      li.append(name);
      if(row.task)li.append(el("span","at-task",row.task));
      li.append(state);
      if(row.children.length){
        const nested=el("ul");for(const child of row.children)nested.append(item(child,false));li.append(nested);
      } else if(root && empty)li.append(el("p","at-note","Пока нет дочерних агентов"));
      return li;
    }
    view=untrack(()=>watchTree(server,id,({tree,error,changed,empty})=>{
      if(changed && labels.has(changed.id)){status(labels.get(changed.id),changed.state);return}
      note.replaceChildren();labels.clear();branch.replaceChildren();
      if(error){
        note.textContent=tree?"Не удалось обновить дерево. Показаны последние данные.":"Не удалось загрузить дерево.";
        const retry=el("button","","Повторить");retry.type="button";retry.onclick=()=>view.refresh();note.append(retry);
      } else if(!tree)note.textContent="Загрузка дерева…";
      if(tree)branch.append(item(tree,true,empty));
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
    ctx.add(Style,css);
    ctx.add(Panel,{id:"tree",region:"side",width:"narrow",
      list:({open})=>open.includes(tab.id)?[tab]:[], render:panel});
    ctx.add(MenuItem,()=>{
      const s=ctx.sessions.current();
      if(s)return {menu:"session.panel",id:"show-tree",title:"Агенты",icon:"file-tree",order:0,
        opened:ctx.layout.state(key,s)!=="closed",run:()=>ctx.layout.open(key,s)};
    });
  }
});
