/* Focused interaction layer: active nav, progress, restrained motion */
(() => {
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const topbar=document.querySelector('.topbar');
  const progress=document.getElementById('scrollProgress');

  const navReset=document.createElement('style');
  navReset.textContent='.nav a:before{content:none!important}.topbar>.refresh-top:before{content:none!important}body.commish .nav a:nth-child(3){display:flex!important}';
  document.head.appendChild(navReset);

  try{
    if(localStorage.getItem('dbd_seen_home')) document.body.classList.add('returning-visitor');
    else localStorage.setItem('dbd_seen_home','1');
  }catch(_){}

  function onScroll(){
    const y=window.scrollY||0;
    topbar?.classList.toggle('scrolled',y>10);
    if(progress){
      const max=Math.max(1,document.documentElement.scrollHeight-innerHeight);
      progress.style.width=`${Math.min(100,Math.max(0,y/max*100))}%`;
    }
  }
  addEventListener('scroll',onScroll,{passive:true});
  onScroll();

  const hero=document.querySelector('.hero.reveal-section');
  if(hero){
    if(reduced) hero.classList.add('is-visible');
    else{
      requestAnimationFrame(()=>requestAnimationFrame(()=>hero.classList.add('is-visible')));
    }
  }

  const navLinks=[...document.querySelectorAll('.nav [data-nav]')];
  const sectionObserver=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
    if(!visible) return;
    navLinks.forEach(a=>a.classList.toggle('active',a.dataset.nav===visible.target.id));
  },{rootMargin:'-25% 0px -60%',threshold:[.05,.2,.5]});

  function observeSections(){
    ['week','analytics','edge','standings','history'].forEach(id=>{
      const el=document.getElementById(id);
      if(el&&!el.dataset.navObserved){el.dataset.navObserved='1';sectionObserver.observe(el);}
    });
  }

  function moveEdgeUp(){
    const edge=document.getElementById('edge');
    const heroNode=document.querySelector('.hero');
    if(!edge||!heroNode||edge.dataset.repositioned) return;
    edge.dataset.repositioned='1';
    heroNode.insertAdjacentElement('afterend',edge);
    observeSections();
  }

  observeSections();
  moveEdgeUp();

  const mutationObserver=new MutationObserver(mutations=>{
    if(!mutations.some(m=>m.addedNodes.length)) return;
    moveEdgeUp();
    observeSections();
  });
  mutationObserver.observe(document.body,{subtree:true,childList:true});

  navLinks.forEach(a=>a.addEventListener('click',()=>{
    navLinks.forEach(x=>x.classList.toggle('active',x===a));
  }));
})();
