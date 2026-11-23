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
