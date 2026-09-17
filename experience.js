/* Mobile-first interaction polish: section reveals, active nav, progress, dynamic card motion */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const topbar = document.querySelector('.topbar');
  const progress = document.getElementById('scrollProgress');

  function onScroll(){
    const y = window.scrollY || 0;
    topbar?.classList.toggle('scrolled', y > 10);
    if(progress){
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      progress.style.width = `${Math.min(100, Math.max(0, y / max * 100))}%`;
    }
  }
  addEventListener('scroll', onScroll, {passive:true});
  onScroll();

  const revealObserver = reduced ? null : new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, {threshold:.08, rootMargin:'0px 0px -40px'});

  function registerReveal(root=document){
    root.querySelectorAll?.('.reveal-section:not(.is-visible)').forEach(el => {
      if(reduced) el.classList.add('is-visible'); else revealObserver.observe(el);
    });
    root.querySelectorAll?.('.match-card,.medal-card,.recap-card,.recommendation-card').forEach((el,i) => {
      if(el.dataset.motionReady) return;
      el.dataset.motionReady='1';
      el.classList.add('reveal-item');
      if(reduced){el.classList.add('is-visible');return;}
      el.style.transitionDelay=`${Math.min(i,5)*45}ms`;
      const itemObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {if(e.isIntersecting){e.target.classList.add('is-visible');itemObserver.unobserve(e.target);}});
      }, {threshold:.05});
      itemObserver.observe(el);
    });
  }
  registerReveal();

  const navLinks=[...document.querySelectorAll('.nav [data-nav]')];
  const sectionObserver = new IntersectionObserver(entries => {
    const visible = entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
    if(!visible) return;
    const id=visible.target.id;
    navLinks.forEach(a=>a.classList.toggle('active',a.dataset.nav===id));
  }, {rootMargin:'-25% 0px -60%',threshold:[.05,.2,.5]});

  function observeSections(){
    ['week','analytics','edge','standings','history'].forEach(id=>{
      const el=document.getElementById(id);if(el&&!el.dataset.navObserved){el.dataset.navObserved='1';sectionObserver.observe(el);}
    });
  }
  observeSections();

  function moveEdgeUp(){
    const edge=document.getElementById('edge');
    const hero=document.querySelector('.hero');
    if(!edge||!hero||edge.dataset.repositioned) return;
    edge.dataset.repositioned='1';
    edge.classList.add('reveal-section');
    hero.insertAdjacentElement('afterend',edge);
    registerReveal(edge.parentElement||document);
    observeSections();
  }
  moveEdgeUp();

  const mutationObserver=new MutationObserver(mutations=>{
    let shouldRegister=false;
    for(const m of mutations){if(m.addedNodes.length){shouldRegister=true;break;}}
    if(shouldRegister){moveEdgeUp();registerReveal();observeSections();}
  });
  mutationObserver.observe(document.body,{subtree:true,childList:true});

  navLinks.forEach(a=>a.addEventListener('click',()=>{
    navLinks.forEach(x=>x.classList.toggle('active',x===a));
  }));
})();
