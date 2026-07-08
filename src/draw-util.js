
/* ============================================================
   Module: DrawUtil
   責務: ストローク描画アルゴリズム（Main + SubWin 共通）
   ============================================================ */
const DrawUtil=(() => {
  /* v6: 全描画関数が transform (viewport.transform) を受け取り PDF座標→canvas座標変換を行う。
     sc (renderScale / innerScale) は transform から自動導出。
     これにより回転PDFでも位置ズレが発生しない。 */
  function drawStroke(s,ctx,transform){
    ctx.save();
    const sc=Utils.getVPScale(transform);
    const lw=s.size*sc/3;
    const pt=(px,py)=>Utils.pdfToCanvas(px,py,transform);
    if(s.type==='eraser'){
      ctx.globalCompositeOperation='destination-out';
      ctx.lineWidth=lw*4;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();
      s.points.forEach((p,i)=>{const c=pt(p[0],p[1]);i?ctx.lineTo(c.x,c.y):ctx.moveTo(c.x,c.y);});
      ctx.stroke();
    }else if(s.type==='pen'||s.type==='hl'){
      ctx.globalCompositeOperation='source-over';
      ctx.globalAlpha=s.type==='hl'?0.38:1;
      ctx.strokeStyle=s.color;
      ctx.lineWidth=s.type==='hl'?Math.max(lw*4,5*sc/3):lw;
      ctx.lineCap='round';ctx.lineJoin='round';
      const pts=s.points;
      if(pts&&pts.length){
        const c0=pt(pts[0][0],pts[0][1]);
        ctx.beginPath();ctx.moveTo(c0.x,c0.y);
        for(let i=1;i<pts.length-1;i++){
          const ci=pt(pts[i][0],pts[i][1]),cn=pt(pts[i+1][0],pts[i+1][1]);
          ctx.quadraticCurveTo(ci.x,ci.y,(ci.x+cn.x)/2,(ci.y+cn.y)/2);
        }
        if(pts.length>1){const cl=pt(pts[pts.length-1][0],pts[pts.length-1][1]);ctx.lineTo(cl.x,cl.y);}
        ctx.stroke();
      }
    }else{ /* v16: text branch削除 */
      /* v16: shape描画削除 (type:rect/circle/line/arrow) */
    }
    ctx.restore();
  }

  function drawAnnotations(ctx,strks,transform){
    if(!strks?.length)return;
    strks.forEach(s=>drawStroke(s,ctx,transform));
  }

  function drawLivePen(ctx,s,transform){
    ctx.save();
    const sc=Utils.getVPScale(transform);
    ctx.globalCompositeOperation='source-over';
    ctx.globalAlpha=s.type==='hl'?0.38:1;
    ctx.strokeStyle=s.color;
    ctx.lineWidth=s.type==='hl'?Math.max(s.size*4,5)*sc/3:s.size*sc/3;
    ctx.lineCap='round';ctx.lineJoin='round';
    const pts=s.points;
    const pt=(px,py)=>Utils.pdfToCanvas(px,py,transform);
    if(pts.length>=3){
      const cPP=pt(pts[pts.length-3][0],pts[pts.length-3][1]);
      const cCP=pt(pts[pts.length-2][0],pts[pts.length-2][1]);
      const cCur=pt(pts[pts.length-1][0],pts[pts.length-1][1]);
      const pmx=(cPP.x+cCP.x)/2,pmy=(cPP.y+cCP.y)/2;
      const cmx=(cCP.x+cCur.x)/2,cmy=(cCP.y+cCur.y)/2;
      ctx.beginPath();ctx.moveTo(pmx,pmy);ctx.quadraticCurveTo(cCP.x,cCP.y,cmx,cmy);ctx.stroke();
    }else if(pts.length===2){
      const c0=pt(pts[0][0],pts[0][1]),c1=pt(pts[1][0],pts[1][1]);
      ctx.beginPath();ctx.moveTo(c0.x,c0.y);ctx.lineTo(c1.x,c1.y);ctx.stroke();
    }
    ctx.restore();
  }

  /* drawEraserCursor: p は PDF座標。transform でcanvas座標に変換してarcを描く。 */
  function drawEraserCursor(ctx,p,s,transform,invEZ){
    const sc=Utils.getVPScale(transform);
    const{x:cx,y:cy}=Utils.pdfToCanvas(p.x,p.y,transform);
    ctx.save();
    ctx.strokeStyle='#888';ctx.lineWidth=Math.max(1,1.5*invEZ);
    ctx.setLineDash([4*invEZ,2*invEZ]);
    ctx.beginPath();ctx.arc(cx,cy,s.size*2*sc/3,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }

  /* 消しゴム: ペン点からセグメントへの距離で部分削除 */
  // Refactor: _distPtSeg() ラッパー削除。直接 Utils.distPtSeg() を呼ぶ

  function applyEraser(penStroke,erPts,hitR){
    if(!penStroke.points?.length||erPts.length===0)return[penStroke];
    const ptHits=(px,py)=>{
      if(Math.hypot(px-erPts[0][0],py-erPts[0][1])<hitR)return true;
      for(let i=1;i<erPts.length;i++){
        if(Utils.distPtSeg(px,py,erPts[i-1][0],erPts[i-1][1],erPts[i][0],erPts[i][1])<hitR)return true;
      }
      return false;
    };
    const kept=penStroke.points.map(pp=>ptHits(pp[0],pp[1])?null:pp);
    for(let j=1;j<kept.length;j++){
      if(kept[j-1]===null||kept[j]===null)continue;
      const[ax,ay]=kept[j-1],[bx,by]=kept[j];
      if(ptHits((ax+bx)/2,(ay+by)/2)){kept[j-1]=null;kept[j]=null;continue;}
      if(Math.hypot(bx-ax,by-ay)>hitR*2){
        if(ptHits(ax*.75+bx*.25,ay*.75+by*.25)||ptHits(ax*.25+bx*.75,ay*.25+by*.75)){kept[j-1]=null;kept[j]=null;}
      }
    }
    const result=[];let seg=[];
    for(const p of kept){
      if(p!==null){seg.push(p);}
      else{if(seg.length>=2)result.push({...penStroke,points:[...seg]});seg=[];}
    }
    if(seg.length>=2)result.push({...penStroke,points:[...seg]});
    return result;
  }

  function applyEraserAll(stroke,erPts,hitR){
    /* ②確認: hitR = size*2/3 (doc単位). cursor radius = size*2*sc/3 (canvas px). scale後に一致 */
    /* v16: text eraser special case削除 */
    if((stroke.type==='pen'||stroke.type==='hl')&&stroke.points?.length)return applyEraser(stroke,erPts,hitR);
    const bb=Utils.strokeBBox(stroke);if(!bb)return[stroke];
    for(let i=0;i<erPts.length;i++){
      const[ex,ey]=erPts[i];
      if(ex>=bb.x1-hitR&&ex<=bb.x2+hitR&&ey>=bb.y1-hitR&&ey<=bb.y2+hitR)return[];
      if(i>0){
        const cx=(bb.x1+bb.x2)/2,cy=(bb.y1+bb.y2)/2;
        const reach=hitR+Math.hypot(bb.x2-bb.x1,bb.y2-bb.y1)/2;
        if(Utils.distPtSeg(cx,cy,erPts[i-1][0],erPts[i-1][1],ex,ey)<reach)return[];
      }
    }
    return[stroke];
  }

  /* PDF回転補正 */
  return{drawStroke,drawAnnotations,drawLivePen,drawEraserCursor,applyEraser,applyEraserAll}; /* v41: 未使用のrotateCanvas削除 */
})();

