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
