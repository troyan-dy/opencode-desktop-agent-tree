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
