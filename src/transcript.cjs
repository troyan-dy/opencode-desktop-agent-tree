"use strict";
const {createRoot,getOwner,createEffect,createSignal,createComponent,For,Show,onCleanup,untrack}=require("solid-js");
const {insert}=require("solid-js/web");
const {el}=require("./card-view.cjs");

const css=`
.oc-agent-preview-layer{position:absolute;inset:0;z-index:60;pointer-events:none;padding:clamp(10px,2.5%,24px);display:grid;min-width:0;min-height:0}
.oc-agent-preview[open]{pointer-events:auto;position:relative;inset:auto;display:flex;flex-direction:column;box-sizing:border-box;width:100%;height:100%;max-height:100%;max-width:100%;min-height:0;min-width:0;margin:0;padding:0;overflow:hidden;
 border:1px solid var(--v2-border-base,GrayText);border-radius:12px;box-shadow:0 12px 40px #0005,0 2px 8px #0003;
 background:var(--v2-background-bg-layer-01,Canvas);color:var(--v2-text-text-base,CanvasText);font:inherit}
.oc-agent-preview header{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--v2-border-base,GrayText)}
.oc-agent-preview h2{font-size:15px;font-weight:600;overflow-wrap:anywhere;margin:2px 0}
.oc-agent-preview small,.oc-agent-preview .ap-notice{font-size:12px;color:var(--v2-text-text-muted,GrayText)}
.oc-agent-preview button{font:inherit;cursor:pointer;border-radius:5px;padding:3px 7px}
.oc-agent-preview [hidden]{display:none!important}
.oc-agent-preview button:focus-visible,.oc-agent-preview summary:focus-visible{outline:2px solid currentColor;outline-offset:1px}
.oc-agent-preview .ap-close{font-size:23px;line-height:1;flex:none}
.oc-agent-preview .ap-feed{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:12px clamp(10px,3%,24px);scrollbar-gutter:stable;overflow-anchor:none}
.oc-agent-preview .ap-msg{margin-bottom:12px;overflow-wrap:anywhere}
.oc-agent-preview .ap-msg>strong{display:block;font-size:12px;color:var(--v2-text-text-muted,GrayText);margin-bottom:4px}
.oc-agent-preview .ap-note,.oc-agent-preview pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
.oc-agent-preview details{margin:4px 0}.oc-agent-preview summary{cursor:pointer;font-size:12px;color:var(--v2-text-text-muted,GrayText)}
.oc-agent-preview .ap-tools{font-size:12px;margin:6px 0;padding:6px 9px;border-inline-start:2px solid var(--v2-border-base,GrayText)}
`;

function visibleMessage(m){
  return m.type==="user" || m.type==="shell" || (m.type==="assistant" && (m.error ||
    m.content.some(p=>p.type==="tool" || (p.type==="text" && p.text))));
}
function messageNode(m,ui){
  const node=el("article","ap-msg");
  node.append(el("strong","",m.type==="user"?"Поручение":m.type==="shell"?"Команда":"Агент"));
  function markdown(text){
    const content=el("div");
    insert(content,()=>createComponent(ui.Markdown,{get text(){return text()}}));
    return content;
  }
  if(m.type==="user"){
    node.append(markdown(()=>m.text));
    insert(node,()=>m.files?.map(f=>el("small","","📎 "+(f.filename||f.mime||"Файл"))));
  }else if(m.type==="shell"){
    const pre=el("pre");insert(pre,()=>[m.command,m.output].filter(Boolean).join("\n"));node.append(pre);
  }else{
    insert(node,createComponent(For,{get each(){return m.content},children:p=>{
      if(p.type==="text")return markdown(()=>p.text);
      if(p.type!=="tool")return;
      const fold=el("details"),title=el("summary");
      const [open,setOpen]=createSignal(false);
      fold.ontoggle=()=>setOpen(fold.open);
      insert(title,()=>`${p.name} · ${p.state.status==="completed"?"готово":p.state.status==="error"?"ошибка":"в работе"}`);
      fold.append(title);
      insert(fold,createComponent(Show,{get when(){return open()},get children(){
        const pre=el("pre","ap-tools");
        insert(pre,()=>[p.state.input && JSON.stringify(p.state.input,null,2),
          ...(p.state.content||[]).map(c=>c.type==="text"?c.text:"[Файл]"),p.state.error?.message].filter(Boolean).join("\n"));
        return pre;
      }}));
      return fold;
    }}));
    const error=el("div","ap-note");insert(error,()=>m.error?.message||"");node.append(error);
  }
  return node;
}

// Own only this preview. The main timeline, composer and sidebar never change route or owner.
function createPreview(ui){
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
      const header=el("header"),caption=el("div"),heading=el("h2","",row.title);
      caption.append(el("small","","Диалог агента · просмотр"),heading);
      dialog.setAttribute("aria-label",`Диалог агента: ${row.title}`);
      const cross=el("button","ap-close","×");cross.type="button";cross.setAttribute("aria-label","Закрыть диалог агента");
      header.append(caption,cross);
      const feed=el("div","ap-feed"),more=el("button","","Показать предыдущие сообщения"),notice=el("div","ap-notice"),retry=el("button","","Повторить"),messages=el("div");
      more.type=retry.type="button";notice.setAttribute("role","status");feed.tabIndex=0;
      feed.append(more,notice,retry,messages);dialog.append(header,feed);layer.append(dialog);
      host.append(layer);dialog.show();cross.focus({preventScroll:true});
      const branch=trigger.closest(".oc-agent-tree"),ctrl=new AbortController();
      const finish=restore=>{
        current=null;dispose();
        if(restore){
          const focus=trigger.isConnected?trigger:branch?.querySelector(`[data-session-id="${CSS.escape(row.id)}"]`);
          focus?.focus({preventScroll:true});
        }
      };
      current=finish;cross.onclick=()=>finish(true);
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
      const store=server.data.session.message,id=row.id;
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
        untrack(sync);
      });
      more.onclick=older;retry.onclick=()=>error().includes("предыдущие")?older():sync();
      const list=()=>store.list(id).filter(visibleMessage);
      insert(messages,createComponent(For,{get each(){return list()},children:m=>messageNode(m,ui)}));
      createEffect(()=>{
        more.hidden=!store.more(id);more.disabled=store.loading(id)||server.connected===false;
        retry.hidden=!error()||server.connected===false;
        notice.textContent=server.connected===false?"Нет связи. Показана загруженная переписка.":error()||
          (list().length?"":loading()?"Загрузка переписки…":"Сообщений пока нет.");
      });
    },owner);
    return true;
  }
  return {open,close};
}
module.exports={createPreview,css};
