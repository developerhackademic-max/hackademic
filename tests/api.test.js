process.env.DB_PATH=':memory:';
const test=require('node:test');
const assert=require('node:assert/strict');
const server=require('../server');
const {demoSeed,one,run}=require('../db');
demoSeed();

test('public API, HR enquiry management, and certificate verification',async()=>{
  const student=one("SELECT id FROM users WHERE email='student@hackademic.demo'");
  const course=one("SELECT id FROM courses WHERE slug='ethical-hacking-cyber-security'");
  run('INSERT INTO certificates(user_id,course_id,code,issued_at) VALUES(?,?,?,?)',student.id,course.id,'HA-2026-001','2026-11-18T00:00:00.000Z');
  await new Promise(resolve=>server.listen(0,resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    let r=await fetch(base+'/api/health');
    assert.equal(r.status,200);
    assert.equal((await r.json()).ok,true);
    r=await fetch(base+'/api/courses');
    assert.equal(r.status,200);
    assert.ok((await r.json()).items.length>0);
    r=await fetch(base+'/api/manage/users');
    assert.equal(r.status,401);
    r=await fetch(base+'/portal.html');
    assert.equal(r.status,200);
    const portal=await r.text();
    assert.equal((portal.match(/class="site-footer"/g)||[]).length,1);
    assert.ok(!portal.includes('Development platform preview'));
    assert.ok(portal.includes('href="/portal.html">Manager Panel</a>'));
    assert.ok(portal.includes('href="/about.html">About Us</a>'));
    assert.ok(!portal.includes('href="/portal.html">Student Login</a>'));
    const portalScript=await (await fetch(base+'/portal.js')).text();
    assert.match(portalScript,/student:\['overview','lectures','materials','assignments','receipts','profile'\]/);
    for(const label of ["overview:'Dashboard'","lectures:'Lectures'","materials:'Materials'","assignments:'Assignments'","receipts:'Fee Receipts'","profile:'Profile'"])assert.ok(portalScript.includes(label));
    assert.ok(portalScript.includes('/api/my/recordings'));
    r=await fetch(base+'/careers.html');
    assert.equal(r.status,200);
    const careers=await r.text();
    assert.equal((careers.match(/class="site-footer"/g)||[]).length,1);
    assert.ok(careers.includes('href="/portal.html">Manager Panel</a>'));
    assert.ok(careers.includes('href="/about.html">About Us</a>'));
    assert.ok(!careers.includes('href="/portal.html">Student Login</a>'));
    r=await fetch(base+'/about.html');
    assert.equal(r.status,200);
    const aboutPage=await r.text();
    const aboutTitle=(aboutPage.match(/<title>(.*?)<\/title>/)||[])[1]||'';
    const aboutDescription=(aboutPage.match(/<meta name="description" content="(.*?)">/)||[])[1]||'';
    assert.ok(aboutTitle.length>=50&&aboutTitle.length<=60);
    assert.ok(aboutDescription.length>=140&&aboutDescription.length<=160);
    assert.ok(aboutPage.includes('<link rel="canonical" href="https://www.hackademic.in/about.html">'));
    assert.equal((aboutPage.match(/<h1\b/g)||[]).length,1);
    assert.ok(aboutPage.includes('<h1 id="about-heading">About <span class="gradient">Hackademic</span></h1>'));
    const aboutHero=(aboutPage.match(/<section class="hero"[\s\S]*?<\/section>/)||[])[0]||'';
    assert.match(aboutHero,/<div class="hero-intro">[\s\S]*?<h1 id="about-heading">About <span class="gradient">Hackademic<\/span><\/h1>/);
    assert.ok(!aboutHero.includes('hero-art'));
    assert.ok(!aboutHero.includes('class="shield"'));
    assert.ok(aboutPage.includes('.hero-copy{max-width:790px;margin:0 auto;text-align:center}'));
    assert.ok(aboutPage.includes('.hero-actions{display:flex;justify-content:center;'));
    assert.ok(aboutPage.includes('@keyframes hero-particles'));
    assert.ok(aboutPage.includes('.hero::before,.hero::after{animation:none!important}'));
    assert.ok(aboutPage.includes('@keyframes hero-halo'));
    assert.ok(aboutPage.includes('Mission &amp; <span class="gradient">vision</span>'));
    const purpose=(aboutPage.match(/<section class="purpose"[\s\S]*?<\/section>/)||[])[0]||'';
    assert.equal((purpose.match(/class="purpose-card(?: primary)? reveal"/g)||[]).length,2);
    assert.ok(purpose.includes('responsibly and gain confidence applying their skills'));
    assert.ok(purpose.includes('a digitally resilient future'));
    assert.ok(purpose.includes('build safer, more inclusive digital spaces'));
    assert.ok(aboutPage.includes('@keyframes purpose-emphasis'));
    assert.ok(aboutPage.includes('@keyframes purpose-icon-glow'));
    assert.ok(aboutPage.includes('.purpose-card small{position:relative;z-index:1;display:inline-flex;'));
    assert.ok(aboutPage.includes('.purpose-card.primary small{border-color:rgba(99,220,255,.28);'));
    assert.ok(aboutPage.includes('@media(prefers-reduced-motion:reduce)'));
    assert.ok(aboutPage.includes('Madhya Pradesh Forest Department'));
    assert.ok(aboutPage.includes('Kailash Lasiyal'));
    assert.ok(!aboutPage.includes('Naina Birla'));
    assert.ok(aboutPage.includes('.team-grid{display:flex;flex-wrap:wrap;justify-content:center;gap:18px}'));
    const team=(aboutPage.match(/<section aria-labelledby="team-heading">[\s\S]*?<\/section>/)||[])[0]||'';
    assert.equal((team.match(/<article class="team-card reveal">/g)||[]).length,4);
    assert.ok(team.includes('<p class="team-role">Sr. Graphic Designer</p>'));
    assert.ok(team.includes('<p class="team-role">BDE (Business Development Executive)</p>'));
    assert.ok(team.includes('consistent visual communication'));
    assert.ok(team.includes('social media content and strategy'));
    assert.ok(team.includes('building and managing Hackademic’s digital presence'));
    assert.ok(team.includes('consultative selling and strong relationships'));
    for(const url of [
      'https://www.linkedin.com/in/kailash-lasiyal-1b824a306',
      'https://www.linkedin.com/in/dev-saini-160b053a9/',
      'https://www.linkedin.com/in/monika-rawat-0a139037a',
      'https://www.linkedin.com/in/aditya-bari-5ab2b5281/'
    ])assert.ok(team.includes(`href="${url}" target="_blank" rel="noopener noreferrer"`));
    assert.ok(aboutPage.includes('<footer class="site-footer">'));
    assert.ok(aboutPage.includes('href="/about.html">About Us</a>'));
    assert.ok(!aboutPage.includes('href="#">'));
    const initiatives=(aboutPage.match(/<div class="achievement-viewport"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)||[])[0]||'';
    assert.equal((initiatives.match(/class="achievement-set"/g)||[]).length,2);
    assert.equal((initiatives.match(/<article class="achievement reveal"/g)||[]).length,5);
    assert.ok(initiatives.includes('<div class="achievement-set" aria-hidden="true">'));
    assert.deepEqual([...initiatives.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]),[
      'Network defence training','Madhya Pradesh Forest Department','Cyber-resilient futures at APS Bhopal','Cyber Suraksha','Motherlands Academy, Kotdwara',
      'Network defence training','Madhya Pradesh Forest Department','Cyber-resilient futures at APS Bhopal','Cyber Suraksha','Motherlands Academy, Kotdwara'
    ]);
    assert.ok(aboutPage.includes('.achievement-viewport:hover .achievement-track,.achievement-viewport:focus-within .achievement-track{animation-play-state:paused}'));
    assert.ok(aboutPage.includes('@keyframes achievement-marquee{to{transform:translateX(-50%)}}'));
    const aboutSchemas=[...aboutPage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
    assert.deepEqual(aboutSchemas.map(schema=>schema['@type']),['EducationalOrganization','BreadcrumbList']);
    r=await fetch(base+'/contact.html');
    assert.equal(r.status,200);
    assert.match(r.headers.get('content-security-policy')||'',/frame-src https:\/\/www\.google\.com/);
    const contactPage=await r.text();
    const contactTitle=(contactPage.match(/<title>(.*?)<\/title>/)||[])[1]||'';
    const contactDescription=(contactPage.match(/<meta name="description" content="(.*?)">/)||[])[1]||'';
    assert.ok(contactTitle.length>=50&&contactTitle.length<=60);
    assert.ok(contactDescription.length>=140&&contactDescription.length<=160);
    assert.ok(contactPage.includes('<link rel="canonical" href="https://www.hackademic.in/contact.html">'));
    assert.equal((contactPage.match(/<h1\b/g)||[]).length,1);
    assert.ok(contactPage.includes('<h1 class="reveal" id="contact-heading">Contact <span class="gradient">Hackademic</span></h1>'));
    assert.ok(contactPage.includes('<form id="contact-form" novalidate>'));
    assert.ok(contactPage.includes('name="name"'));
    assert.ok(contactPage.includes('name="email"'));
    assert.ok(contactPage.includes('name="phone"'));
    assert.ok(contactPage.includes('name="subject"'));
    assert.ok(contactPage.includes('name="message"'));
    assert.ok(contactPage.includes("fetch('/api/leads'"));
    r=await fetch(base+'/enroll.html');
    assert.equal(r.status,200);
    const enrollmentPage=await r.text();
    assert.ok(enrollmentPage.includes('<form id="enroll-form">'));
    assert.ok(enrollmentPage.includes("fetch('/api/leads'"));
    assert.ok(enrollmentPage.includes('name="interest"'));
    assert.ok(enrollmentPage.includes('<nav class="primary-nav" id="primary-nav" aria-label="Primary navigation">'));
    assert.ok(enrollmentPage.includes('class="menu-toggle"'));
    const enrollmentHome=await (await fetch(base+'/')).text();
    assert.ok(enrollmentHome.includes('href="/enroll.html?course=Master%20in%20Graphic%20Designing"'));
    for(const coursePath of ['/course-graphic-design.html','/course-web-development.html','/course-ccna.html','/course-threat-intelligence.html','/course-cyber-security.html']){
      const coursePage=await (await fetch(base+coursePath)).text();
      assert.match(coursePage,/href="\/enroll\.html\?course=/);
    }
    r=await fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Course Enrollment Test',email:'course-enroll@example.com',phone:'6396111576',interest:'Master Program in Web Development',message:'Course enrollment request.'})});
    assert.equal(r.status,201);
    const enrollmentLead=one("SELECT interest,message FROM leads WHERE email='course-enroll@example.com'");
    assert.equal(enrollmentLead.interest,'Master Program in Web Development');
    assert.match(enrollmentLead.message,/Course enrollment request/);
    assert.ok(contactPage.includes('href="https://wa.me/916396111576"'));
    assert.ok(contactPage.includes('title="Hackademic location map" loading="lazy"'));
    assert.ok(contactPage.includes('src="https://www.google.com/maps?q=30.3014741%2C78.0551728&amp;z=17&amp;output=embed"'));
    assert.equal((contactPage.match(/href="https:\/\/maps\.app\.goo\.gl\/Fgjvrs7hWUFvz14i8"/g)||[]).length,2);
    const contactSchemas=[...contactPage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
    assert.deepEqual(contactSchemas.map(schema=>schema['@type']),['ContactPage','BreadcrumbList']);
    r=await fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Contact Form Test',email:'contact-form@example.com',phone:'6396111576',interest:'General enquiry',message:'Contact page form integration test'})});
    assert.equal(r.status,201);
    assert.equal(one("SELECT interest FROM leads WHERE email='contact-form@example.com'").interest,'General enquiry');
    r=await fetch(base+'/sitemap.xml');
    const contactSitemap=await r.text();
    assert.ok(contactSitemap.includes('https://www.hackademic.in/about.html'));
    assert.ok(contactSitemap.includes('https://www.hackademic.in/contact.html'));
    assert.ok(contactSitemap.includes('https://www.hackademic.in/enroll.html'));
    r=await fetch(base+'/footer.css');
    assert.equal(r.status,200);
    r=await fetch(base+'/');
    const home=await r.text();
    for(const path of ['/','/about.html','/courses.html','/services.html','/quotation.html','/contact.html']){
      const pageResponse=await fetch(base+path);
      assert.equal(pageResponse.status,200);
      const page=await pageResponse.text();
      const nav=(page.match(/<nav\b[^>]*class=["'][^"']*nav-links[^"']*["'][^>]*>[\s\S]*?<\/nav>/)||[])[0]||'';
      assert.doesNotMatch(nav,/<a\b[^>]*href=["'][^"']*#reviews["'][^>]*>\s*Reviews\s*<\/a>/i);
      assert.match(nav,/<a\b[^>]*href="\/contact\.html"[^>]*>Contact<\/a>/);
    }
    const landingFooter=(home.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)||[])[0]||'';
    const aboutFooter=(aboutPage.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)||[])[0]||'';
    const contactFooter=(contactPage.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)||[])[0]||'';
    assert.equal(aboutFooter.replace(/\s+/g,' '),landingFooter.replace(/\s+/g,' '));
    assert.equal(contactFooter.replace(/\s+/g,' '),landingFooter.replace(/\s+/g,' '));
    assert.ok(!home.includes('christmas-offer'));
    assert.ok(!home.includes('Explore our'));
    assert.ok(home.includes('<header class="nav">'));
    assert.ok(home.includes('<a href="/about.html">About</a>'));
    assert.ok(home.includes('href="/about.html">About Us</a>'));
    assert.ok(home.indexOf('href="/contact.html">Contact</a>')<home.indexOf('href="/certificate.html">Verify Certificate</a>'));
    assert.ok(home.includes('<a class="btn btn-primary btn-sm" href="/portal.html">Learning Hub</a>'));
    assert.ok(!home.includes('>Get Started'));
    assert.ok(!home.includes('href="/portal.html">Student Login</a>'));
    assert.ok(home.indexOf('href="/terms.html"')<home.indexOf('href="/privacy-policy.html"'));
    assert.ok(home.includes('href="/terms.html" target="_blank" rel="noopener noreferrer">Terms &amp; Conditions</a>'));
    assert.ok(home.includes('href="/privacy-policy.html" target="_blank" rel="noopener noreferrer">Privacy Policy</a>'));
    assert.ok(home.includes('<b data-suffix="+">500+</b><span>Students trained</span>'));
    assert.ok(home.includes('<b data-suffix="+">150+</b><span>Projects Done</span>'));
    assert.ok(home.includes('<b data-suffix="+">50+</b><span>Hiring partners</span>'));
    assert.ok(home.includes('<b data-suffix="%">95%</b><span>Placement success</span>'));
    assert.match(home, /<div class="stats-heading">[\s\S]*?Our Impact[\s\S]*?<h2 class="title reveal" id="stats-heading"[^>]*>Results that speak for themselves<\/h2><\/div>\s*<div class="stat-box/);
    const whySection=(home.match(/<section class="why"[\s\S]*?<\/section>/)||[])[0]||'';
    assert.ok(whySection.includes('<b>Government &amp; corporate partnership</b>'));
    assert.ok(whySection.includes('<b>Globally recognized certifications</b>'));
    const servicesSection=(home.match(/<section id="services">([\s\S]*?)<\/section>/)||[])[1]||'';
    assert.deepEqual([...servicesSection.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]),['Government Training','Web Development','Graphic Designing and UI/UX','Digital Marketing Services','Security Auditing']);
    assert.ok(!home.includes('IT Consulting'));
    assert.match(servicesSection,/<div class="card audit reveal"[\s\S]*?<h3>Security Auditing<\/h3>[\s\S]*?<div class="radar">/);
    assert.ok(home.includes('<a href="/services.html">Services</a>'));
    assert.ok(home.includes('href="/services.html#training">Learn more'));
    r=await fetch(base+'/services.html');
    assert.equal(r.status,200);
    const servicesPage=await r.text();
    assert.ok(servicesPage.includes('<title>Cyber Security Services in Dehradun | Hackademic Programs</title>'));
    const heroHeading=servicesPage.match(/<h1 class="load"[^>]*>([\s\S]*?)<\/h1>/);
    assert.ok(heroHeading);
    const heroHeadingText=heroHeading[1].replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
    assert.ok(heroHeadingText.toLowerCase().includes('technology that helps you'));
    assert.ok(!heroHeadingText.toLowerCase().includes('cyber security'));
    const heroParagraph=servicesPage.match(/<p class="lead load"[^>]*>([\s\S]*?)<\/p>/);
    assert.ok(heroParagraph);
    assert.ok(heroParagraph[1].toLowerCase().includes('it services in dehradun'));
    assert.ok(!heroParagraph[1].toLowerCase().includes('cyber security course'));
    const servicesHero=servicesPage.match(/<!-- HERO -->([\s\S]*?)<!-- OVERVIEW -->/);
    assert.ok(servicesHero);
    assert.ok(!servicesHero[1].includes('class="crumbs'));
    for(const metric of ['<b id="serviceCount" data-count="5" data-suffix="">5</b><span>Core services</span>','<b data-count="150" data-suffix="+">150+</b><span>Projects Done</span>','<b data-count="95" data-suffix="%">95%</b><span>Satisfaction</span>','<b data-count="24" data-suffix="/7">24/7</b><span>Support</span>'])assert.ok(servicesPage.includes(metric));
    assert.equal((servicesPage.match(/data-count=/g)||[]).length,4);
    assert.ok(!servicesPage.includes('Placement success'));
    const targetKeywords=['Cyber Security Course in Dehradun','IT Services in Dehradun','Web Development Services in Dehradun','Digital Marketing Services in Dehradun','VAPT Services in Dehradun'];
    const servicesText=servicesPage.toLowerCase();
    for(const keyword of targetKeywords)assert.ok(servicesText.includes(keyword.toLowerCase()),`Missing target keyword: ${keyword}`);
    assert.ok(!servicesPage.includes('<meta name="keywords"'));
    const serviceSubtitles=[...servicesPage.matchAll(/<p class="svc-subtitle[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map(match=>match[1].replace(/<[^>]*>/g,'').toLowerCase());
    assert.equal(serviceSubtitles.length,5);
    for(const subtitle of serviceSubtitles)assert.ok(!targetKeywords.some(keyword=>subtitle.includes(keyword.toLowerCase())));
    const servicesSchemas=[...servicesPage.matchAll(/<script\b(?=[^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
    const itemList=servicesSchemas.find(schema=>schema['@type']==='ItemList');
    assert.ok(itemList);
    assert.equal(itemList.itemListElement.length,5);
    assert.ok(servicesPage.includes('<a class="active" href="/services.html">Services</a>'));
    assert.ok(servicesPage.includes('<a class="btn btn-primary btn-sm" href="/portal.html">Learning Hub</a>'));
    assert.ok(!servicesPage.includes('>Get Started'));
    assert.ok(!servicesPage.includes('<a class="btn btn-outline" href="#contact">Contact Us'));
    assert.equal((servicesPage.match(/<section class="svc[^"]*" id="/g)||[]).length,5);
    for(const quotationLink of [
      'href="/quotation.html">Get a Quote',
      'href="/quotation.html?service=Government%20Training%20Program">Request a Training Program',
      'href="/quotation.html?service=Web%20Development">Start Your Website',
      'href="/quotation.html?service=Graphic%20Design%20Services">Discuss Your Design',
      'href="/quotation.html?service=Digital%20Marketing%20Services">Grow My Business',
      'href="/quotation.html?service=Security%20Audit%20%26%20Assessment">Book a Security Audit'
    ])assert.ok(servicesPage.includes(quotationLink),`Missing quotation link: ${quotationLink}`);
    assert.equal((servicesPage.match(/href="\/quotation\.html(?:\?service=[^"]*)?"/g)||[]).length,6);
    assert.ok(!servicesPage.includes('<section class="stats"'));
    const offerSection=servicesPage.match(/<section class="offer-section"[\s\S]*?<\/section>/);
    assert.ok(offerSection);
    assert.ok(offerSection[0].includes('<h2 class="reveal">What We Offer</h2>'));
    assert.ok(offerSection[0].includes('Expert guidance and dependable support at every step.'));
    assert.ok(!offerSection[0].includes('Service Highlights'));
    assert.ok(!offerSection[0].includes('From the first conversation'));
    assert.equal((offerSection[0].match(/<article class="offer-card/g)||[]).length,6);
    assert.ok(!offerSection[0].includes('offer-index'));
    for(const highlight of ['Expert Consultation','Custom Solutions','Quality Assurance','Timely Delivery','Post-Delivery Support','Competitive Pricing'])assert.ok(offerSection[0].includes(`<h3>${highlight}</h3>`));
    assert.ok(!servicesPage.includes('IT Consulting'));
    assert.ok(servicesPage.includes('Get a Quote <span class="arr">→</span>'));
    assert.ok(servicesPage.includes('src="/assets/hackademic-full-logo.png"'));
    assert.ok(servicesPage.includes('.page-hero .container{display:block;max-width:920px;text-align:center}'));
    assert.ok(!servicesPage.includes('class="orbit-wrap load"'));
    const servicesHeadingPosition=servicesPage.indexOf('Everything your business needs to');
    const categoryBarPosition=servicesPage.indexOf('<nav class="tabs"');
    const serviceCardsPosition=servicesPage.search(/<div class="glance"[^>]*>/);
    assert.ok(servicesHeadingPosition<categoryBarPosition&&categoryBarPosition<serviceCardsPosition);
    assert.ok(servicesPage.includes('.tabs{position:static;background:transparent}'));
    assert.ok(!servicesPage.includes('data:image/png;base64,'));
    assert.ok(servicesPage.includes('<form class="cta-form" id="enquiry-form"'));
    assert.ok(servicesPage.includes('<div class="cta-form-actions">'));
    assert.ok(servicesPage.includes('<button class="btn btn-primary" type="submit">Get Free Consultation <span class="arr">→</span></button>'));
    assert.ok(servicesPage.includes('<a class="btn btn-outline" href="mailto:info@hackademic.in">Contact Us</a>'));
    assert.ok(servicesPage.includes('<script src="/public-api.js"></script>'));
    assert.ok(servicesPage.includes('<footer class="site-footer">'));
    assert.ok(servicesPage.includes('<li><a href="/services.html">Services</a></li>'));
    assert.ok(!servicesPage.includes('350+'));
    assert.ok(!home.includes('id="certificate-form"'));
    r=await fetch(base+'/quotation.html');
    assert.equal(r.status,200);
    const quotationPage=await r.text();
    assert.ok(quotationPage.includes('<h2 id="requirements-heading">Fill Your Requirements</h2>'));
    assert.ok(quotationPage.includes('<a class="back-link" href="/services.html"><span aria-hidden="true">←</span> Back to Services</a>'));
    assert.ok(!quotationPage.includes('class="breadcrumbs"'));
    assert.ok(!quotationPage.includes('<a class="btn btn-primary btn-sm" href="#quotation-form">Request Quotation</a>'));
    assert.ok(quotationPage.includes('<button class="btn btn-primary submit-button" type="submit">Request Quotation'));
    assert.ok(quotationPage.includes('.container{width:min(1240px,calc(100% - 64px));margin:0 auto;position:relative}'));
    assert.ok(quotationPage.includes('.quotation-form{width:100%;margin:0 auto;'));
    assert.ok(quotationPage.includes('<a class="btn btn-primary btn-sm" href="/portal.html">Learning Hub</a>'));
    assert.ok(!quotationPage.includes('>Get Started'));
    for(const field of ['companyName','name','designation','email','phone','service','estimatedBudget','timeline','projectDescription','additionalRequirements'])assert.ok(quotationPage.includes(`name="${field}"`),`Missing quotation field: ${field}`);
    for(const serviceOption of ['Security Audit &amp; Assessment','Vulnerability Assessment &amp; Penetration Testing','Corporate Training Program','Government Training Program','Web Application Security','Network Security Assessment','Compliance &amp; Certification Support','Managed Security Services','Graphic Design Services','Web Development','Digital Marketing Services','Other'])assert.ok(quotationPage.includes(`<option>${serviceOption}</option>`),`Missing service option: ${serviceOption}`);
    for(const budgetOption of ['Below ₹50,000','₹50,000 - ₹1,00,000','₹1,00,000 - ₹5,00,000','₹5,00,000 - ₹10,00,000','Above ₹10,00,000','Not Sure / Need Consultation'])assert.ok(quotationPage.includes(`<option>${budgetOption}</option>`),`Missing budget option: ${budgetOption}`);
    for(const timelineOption of ['Immediate (Within 1 week)','1 - 2 Weeks','1 Month','2 - 3 Months','Flexible'])assert.ok(quotationPage.includes(`<option>${timelineOption}</option>`),`Missing timeline option: ${timelineOption}`);
    assert.ok(quotationPage.includes('pattern="[0-9]{10}"'));
    assert.equal((quotationPage.match(/data-word-limit="200"/g)||[]).length,2);
    assert.ok(quotationPage.includes('Your information is secure and will only be used to prepare your quotation.'));
    r=await fetch(base+'/quotation.js');
    assert.equal(r.status,200);
    assert.match(r.headers.get('content-type')||'',/javascript/);
    const quotationScript=await r.text();
    assert.ok(quotationScript.includes("new URLSearchParams(window.location.search).get('service')"));
    assert.ok(quotationScript.includes("fetch('/api/quotations'"));
    const coursesSection=(home.match(/<!-- COURSES -->([\s\S]*?)<!-- STATS -->/)||[])[1]||'';
    assert.deepEqual([...coursesSection.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]),['Master in Graphic Designing','Master Program in Web Development','Cisco Certified Network Associate (CCNA) Training Program','Threat Intelligence Training Program','Master Program in Cyber Security']);
    assert.deepEqual([...coursesSection.matchAll(/<div class="thumb[^"]*"><em>(.*?)<\/em>/g)].map(match=>match[1]),['Creative Pick','Popular','Trending','In Demand','Bestseller']);
    assert.deepEqual([...coursesSection.matchAll(/<span>⏱ (.*?)<\/span>/g)].map(match=>match[1]),['3 Months','6 Months','2 Months','3 Months','8 Months']);
    assert.equal((coursesSection.match(/class="course-enroll"/g)||[]).length,5);
    assert.equal((coursesSection.match(/class="course-more"/g)||[]).length,5);
    assert.ok(!coursesSection.includes('class="price"'));
    for(const image of ['graphic-design.png','web-development.png','ccna.png','threat-intelligence.png','cyber-security.png']){
      assert.ok(coursesSection.includes(`src="/assets/courses/${image}"`));
      r=await fetch(base+`/assets/courses/${image}`);
      assert.equal(r.status,200);
      assert.match(r.headers.get('content-type')||'',/image\/png/);
    }
    r=await fetch(base+'/courses.html');
    assert.equal(r.status,200);
    const catalog=await r.text();
    assert.ok(catalog.includes('href="/course-graphic-design.html" aria-label="View Master in Graphic Designing course details">View More</a>'));
    assert.ok(catalog.includes('href="/course-web-development.html" aria-label="View Master Program in Web Development course details">View More</a>'));
    assert.ok(catalog.includes('href="/course-ccna.html" aria-label="View CCNA training program course details">View More</a>'));
    assert.ok(catalog.includes('href="/course-threat-intelligence.html" aria-label="View Threat Intelligence training program course details">View More</a>'));
    assert.ok(catalog.includes('href="/course-cyber-security.html" aria-label="View Master Program in Cyber Security course details">View More</a>'));
    r=await fetch(base+'/course-graphic-design.html');
    assert.equal(r.status,200);
    const graphicDesignPage=await r.text();
    assert.ok(graphicDesignPage.includes('<h1 class="big" id="big" aria-label="Create">'));
    assert.ok(graphicDesignPage.includes('<h2 class="sub">Master in <u>Graphic Designing</u></h2>'));
    const heroCopy=(graphicDesignPage.match(/<p class="l">(.*?)<\/p>/)||[])[1]||'';
    assert.equal(heroCopy,'Learn core design principles through hands-on projects and create a portfolio that reflects your ideas.');
    assert.doesNotMatch(heroCopy,/graphic design course in Dehradun/i);
    assert.ok(graphicDesignPage.includes('<img class="hero-art" src="/assets/courses/graphic-design.png" alt="Graphic design workspace with a color palette and creative tools" width="900" height="600" loading="eager" fetchpriority="high" decoding="async">'));
    assert.ok(graphicDesignPage.includes('.hero-art{position:absolute'));
    assert.ok(graphicDesignPage.includes('mask-image:linear-gradient(90deg,transparent 0%,#000 12%,#000 88%,transparent 100%)'));
    assert.ok(graphicDesignPage.includes('transform:translateY(-50%)'));
    assert.ok(graphicDesignPage.includes('<link rel="stylesheet" href="/footer.css">'));
    assert.ok(graphicDesignPage.includes('<footer class="site-footer">'));
    assert.ok(graphicDesignPage.includes('site-footer__social-links'));
    const graphicDesignNavigation=(graphicDesignPage.match(/<nav id="nav"[\s\S]*?<\/nav>/)||[])[0]||'';
    assert.ok(graphicDesignNavigation.includes('href="/courses.html">&larr; Back to Courses</a>'));
    assert.doesNotMatch(graphicDesignNavigation,/HACKADEMIC|Hackademic home/);
    assert.doesNotMatch(graphicDesignPage,/Figma|UI\/UX|UI UX/i);
    assert.ok(graphicDesignPage.includes('<select id="inquiry-course" name="interest">'));
    assert.ok(graphicDesignPage.includes("fetch('/api/leads'"));
    assert.ok(graphicDesignPage.includes('animation:up .9s'));
    assert.ok(graphicDesignPage.includes('<span class="lifetime">Lifetime</span></b></div><small>Access</small>'));
    const curriculum=(graphicDesignPage.match(/<section class="s cu"[\s\S]*?<\/section>/)||[])[0]||'';
    const moduleTitles=['Design Thinking &amp; Principles','Color Theory &amp; Typography','Adobe Photoshop Fundamentals','Advanced Photoshop Techniques','Adobe Illustrator Basics','Vector Design &amp; Logo Creation','Layout Design with InDesign','Brand Identity Design','Social Media Graphics','Print Design &amp; Prepress','Motion Graphics Basics','Portfolio Development','Client Communication','Freelancing &amp; Career Guide'];
    assert.deepEqual([...curriculum.matchAll(/<span class="mod-name">(.*?)<\/span>/g)].map(match=>match[1]),moduleTitles);
    assert.ok(graphicDesignPage.includes('.reveal-ready .ph:nth-child(odd):not(.in)'));
    assert.ok(graphicDesignPage.includes("timeline.style.setProperty('--fill',progress+'%')"));
    const toolsSection=(graphicDesignPage.match(/<section class="s tw">[\s\S]*?<\/section>/)||[])[0]||'';
    assert.deepEqual([...toolsSection.matchAll(/<li><i style="background:[^"]+"><\/i>(.*?)<\/li>/g)].map(match=>match[1]),['Adobe Photoshop','Adobe Illustrator','Canva','Adobe InDesign']);
    assert.deepEqual([...toolsSection.matchAll(/<img src="([^"]+)" alt="([^"]+)" width="70" height="70">/g)].map(match=>match[2]),['Adobe Photoshop','Adobe Illustrator','Canva','Adobe InDesign']);
    assert.ok(toolsSection.includes('aria-label="Graphic design"><svg'));
    for(const logo of ['photoshop.png','illustrator.png','canva.png','indesign.png']){
      r=await fetch(base+`/assets/courses/graphic-design-tools/${logo}`);
      assert.equal(r.status,200);
      assert.match(r.headers.get('content-type')||'',/image\/png/);
    }
    assert.ok(graphicDesignPage.includes('Brand Identity Package'));
    r=await fetch(base+'/course-web-development.html');
    assert.equal(r.status,200);
    const webDevelopmentPage=await r.text();
    assert.ok(webDevelopmentPage.includes('<img class="hero-art" src="/assets/courses/web-development.png" alt="Web developer building software on a laptop" width="900" height="600" loading="eager" fetchpriority="high" decoding="async">'));
    const webTitle=(webDevelopmentPage.match(/<title>(.*?)<\/title>/)||[])[1]||'';
    const webDescription=(webDevelopmentPage.match(/<meta name="description" content="(.*?)">/)||[])[1]||'';
    assert.ok(webDevelopmentPage.includes('<title>Web Development Course in Dehradun | 6-Month Program</title>'));
    assert.ok(webTitle.length>=50&&webTitle.length<=60);
    assert.ok(webDescription.length>=140&&webDescription.length<=160);
    assert.ok(webDevelopmentPage.includes('<link rel="canonical" href="https://www.hackademic.in/course-web-development.html">'));
    const webSchemas=[...webDevelopmentPage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
    assert.deepEqual(webSchemas.map(schema=>schema['@type']),['BreadcrumbList','Course']);
    assert.ok(webDevelopmentPage.includes('<h1 class="big" id="big" aria-label="Build">'));
    assert.ok(webDevelopmentPage.includes('<h2 class="sub">Master Program in <u>Web Development</u></h2>'));
    const courseNavigation=(webDevelopmentPage.match(/<nav id="nav"[\s\S]*?<\/nav>/)||[])[0]||'';
    assert.ok(courseNavigation.includes('href="/courses.html">&larr; Back to Courses</a>'));
    assert.doesNotMatch(courseNavigation,/HACKADEMIC|Hackademic home/);
    assert.equal((webDevelopmentPage.match(/<h1\b/g)||[]).length,1);
    assert.ok(webDevelopmentPage.includes('Duration<b>6 Months</b>'));
    assert.ok(webDevelopmentPage.includes('href="#inquire" class="btn btn-o mag">Get Brochure</a>'));
    assert.ok(webDevelopmentPage.includes('<span data-n="15" data-s="+">15+</span>'));
    assert.ok(webDevelopmentPage.includes('<span data-n="8" data-s="+">8+</span>'));
    assert.ok(webDevelopmentPage.includes('href="https://www.hackademic.in/course-web-development.html"'));
    assert.ok(webDevelopmentPage.includes('<footer class="site-footer">'));
    assert.ok(webDevelopmentPage.includes('<option>Master Program in Web Development</option>'));
    const webCurriculum=(webDevelopmentPage.match(/<section class="s cu"[\s\S]*?<\/section>/)||[])[0]||'';
    const webModules=['HTML5 &amp; CSS3 Fundamentals','JavaScript ES6+','React.js Framework','Node.js &amp; Express','Database Design (SQL &amp; NoSQL)','REST API Development','Authentication &amp; Authorization','State Management','Responsive Design','Git &amp; Version Control','Testing &amp; Debugging','Cloud Deployment (AWS/Vercel)','SEO Best Practices','Performance Optimization','Capstone Project'];
    assert.deepEqual([...webCurriculum.matchAll(/<span class="mod-name">(.*?)<\/span>/g)].map(match=>match[1]),webModules);
    const webTools=(webDevelopmentPage.match(/<section class="s tw">[\s\S]*?<\/section>/)||[])[0]||'';
    assert.deepEqual([...webTools.matchAll(/<li><i style="background:[^"]+"><\/i>(.*?)<\/li>/g)].map(match=>match[1]),['React','Node.js','VS Code','Git','Postman','MongoDB','PostgreSQL','Docker']);
    assert.equal((webTools.match(/<div style="--a:/g)||[]).length,8);
    const webLogos=[...webTools.matchAll(/<img src="([^"]+)" alt="([^"]+)" width="70" height="70" loading="lazy" decoding="async">/g)];
    assert.deepEqual(webLogos.map(match=>match[2]),['React','Node.js','VS Code','Git','Postman','MongoDB','PostgreSQL','Docker']);
    for(const [,logoPath] of webLogos){
      r=await fetch(base+logoPath);
      assert.equal(r.status,200);
      assert.match(r.headers.get('content-type')||'',/image\/png/);
    }
    const webProjects=(webDevelopmentPage.match(/<div class="pj" id="pj">[\s\S]*?<\/div>/)||[])[0]||'';
    assert.deepEqual([...webProjects.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]),['E-Commerce Platform','Social Media Dashboard','Portfolio Website','REST API &amp; Microservices','Real-Time Chat App','SaaS Application']);
    assert.ok(webDevelopmentPage.includes('fetch(\'/api/leads\''));
    const sitemap=await (await fetch(base+'/sitemap.xml')).text();
    assert.ok(sitemap.includes('https://www.hackademic.in/course-web-development.html'));
    r=await fetch(base+'/course-ccna.html');
    assert.equal(r.status,200);
    const ccnaPage=await r.text();
    assert.ok(ccnaPage.includes('<img class="hero-art" src="/assets/courses/ccna.png" alt="Network server racks with glowing connectivity lights" width="900" height="600" loading="eager" fetchpriority="high" decoding="async">'));
    const ccnaTitle=(ccnaPage.match(/<title>(.*?)<\/title>/)||[])[1]||'';
    const ccnaDescription=(ccnaPage.match(/<meta name="description" content="(.*?)">/)||[])[1]||'';
    assert.ok(ccnaTitle.length>=50&&ccnaTitle.length<=60);
    assert.ok(ccnaDescription.length>=140&&ccnaDescription.length<=160);
    assert.ok(ccnaPage.includes('<link rel="canonical" href="https://www.hackademic.in/course-ccna.html">'));
    assert.ok(ccnaPage.includes('<h1 class="big" id="big" aria-label="Connect">'));
    assert.ok(ccnaPage.includes('<h2 class="sub">Cisco Certified Network Associate <u>(CCNA) Training Program</u></h2>'));
    assert.equal((ccnaPage.match(/<h1\b/g)||[]).length,1);
    assert.ok(ccnaPage.includes('Duration<b>2 Months</b>'));
    assert.ok(ccnaPage.includes('<span data-n="16" data-s="+">16+</span>'));
    assert.ok(ccnaPage.includes('<span data-n="6" data-s="+">6+</span>'));
    assert.ok(ccnaPage.includes('<footer class="site-footer">'));
    assert.ok(ccnaPage.includes('<option>Cisco Certified Network Associate (CCNA) Training Program</option>'));
    const ccnaSchemas=[...ccnaPage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
    assert.deepEqual(ccnaSchemas.map(schema=>schema['@type']),['BreadcrumbList','Course']);
    const ccnaNavigation=(ccnaPage.match(/<nav id="nav"[\s\S]*?<\/nav>/)||[])[0]||'';
    assert.ok(ccnaNavigation.includes('href="/courses.html">&larr; Back to Courses</a>'));
    const ccnaCurriculum=(ccnaPage.match(/<section class="s cu"[\s\S]*?<\/section>/)||[])[0]||'';
    const ccnaModules=['Network Fundamentals','OSI &amp; TCP/IP Models','Ethernet &amp; Switching','VLANs &amp; Inter-VLAN Routing','IP Addressing &amp; Subnetting','Static &amp; Dynamic Routing','OSPF Configuration','Network Security Concepts','Access Control Lists (ACLs)','NAT &amp; PAT','VPN Technologies','Wireless Networking','Network Automation Basics','QoS Fundamentals','Network Troubleshooting','CCNA Exam Preparation'];
    assert.deepEqual([...ccnaCurriculum.matchAll(/<span class="mod-name">(.*?)<\/span>/g)].map(match=>match[1]),ccnaModules);
    const ccnaTools=(ccnaPage.match(/<section class="s tw">[\s\S]*?<\/section>/)||[])[0]||'';
    assert.deepEqual([...ccnaTools.matchAll(/<li><i style="background:[^"]+"><\/i>(.*?)<\/li>/g)].map(match=>match[1]),['Cisco Packet Tracer','GNS3','Wireshark','Cisco','SolarWinds','Nmap']);
    assert.equal((ccnaTools.match(/class="tool-mark"/g)||[]).length,6);
    const ccnaToolLogos=[...ccnaTools.matchAll(/<img src="([^"]+)" alt="" width="54" height="54" loading="lazy" decoding="async">/g)].map(match=>match[1]);
    assert.deepEqual(ccnaToolLogos,['/assets/courses/ccna-tools/packet-tracer.png','/assets/courses/ccna-tools/gns3.png','/assets/courses/ccna-tools/solarwinds.png','/assets/courses/ccna-tools/nmap.png','/assets/courses/ccna-tools/wireshark.png','/assets/courses/ccna-tools/cisco.png']);
    for(const logo of ccnaToolLogos){
      r=await fetch(base+logo);
      assert.equal(r.status,200);
      assert.match(r.headers.get('content-type')||'',/image\/png/);
    }
    const ccnaProjects=(ccnaPage.match(/<div class="pj" id="pj">[\s\S]*?<\/div>/)||[])[0]||'';
    assert.deepEqual([...ccnaProjects.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]),['Enterprise Network Design','VLAN &amp; Routing Config','Firewall Configuration Lab','VPN Tunnel Setup','Network Troubleshooting','Wireless Network Security']);
    const updatedSitemap=await (await fetch(base+'/sitemap.xml')).text();
    assert.ok(updatedSitemap.includes('https://www.hackademic.in/course-ccna.html'));
    assert.ok(ccnaPage.includes('fetch(\'/api/leads\''));
    r=await fetch(base+'/course-threat-intelligence.html');
    assert.equal(r.status,200);
    const threatIntelligencePage=await r.text();
    assert.ok(threatIntelligencePage.includes('<img class="hero-art" src="/assets/courses/threat-intelligence.png" alt="Analyst investigating a connected digital threat network" width="900" height="600" loading="eager" fetchpriority="high" decoding="async">'));
    const threatTitle=(threatIntelligencePage.match(/<title>(.*?)<\/title>/)||[])[1]||'';
    const threatDescription=(threatIntelligencePage.match(/<meta name="description" content="(.*?)">/)||[])[1]||'';
    assert.ok(threatTitle.length>=50&&threatTitle.length<=60);
    assert.ok(threatDescription.length>=140&&threatDescription.length<=160);
    assert.ok(threatIntelligencePage.includes('<link rel="canonical" href="https://www.hackademic.in/course-threat-intelligence.html">'));
    assert.ok(threatIntelligencePage.includes('<h1 class="big" id="big" aria-label="Anticipate">'));
    assert.ok(threatIntelligencePage.includes('<h2 class="sub">Threat Intelligence <u>Training Program</u></h2>'));
    assert.equal((threatIntelligencePage.match(/<h1\b/g)||[]).length,1);
    assert.ok(threatIntelligencePage.includes('Duration<b>3 Months</b>'));
    assert.ok(threatIntelligencePage.includes('<span data-n="16" data-s="+">16+</span>'));
    assert.ok(threatIntelligencePage.includes('<span data-n="7" data-s="+">7+</span>'));
    assert.ok(threatIntelligencePage.includes('<span class="lifetime">Lifetime</span></b></div><small>LMS Access</small>'));
    assert.ok(threatIntelligencePage.includes('<footer class="site-footer">'));
    assert.ok(threatIntelligencePage.includes('<option>Threat Intelligence Training Program</option>'));
    const threatSchemas=[...threatIntelligencePage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
    assert.deepEqual(threatSchemas.map(schema=>schema['@type']),['BreadcrumbList','Course']);
    assert.equal(threatSchemas[1].timeRequired,'P3M');
    const threatNavigation=(threatIntelligencePage.match(/<nav id="nav"[\s\S]*?<\/nav>/)||[])[0]||'';
    assert.ok(threatNavigation.includes('href="/courses.html">&larr; Back to Courses</a>'));
    const threatCurriculum=(threatIntelligencePage.match(/<section class="s cu"[\s\S]*?<\/section>/)||[])[0]||'';
    const threatModules=['Intro to Threat Intelligence','Cyber Threat Landscape','OSINT Techniques','Dark Web Monitoring','Threat Actor Profiling','MITRE ATT&amp;CK Framework','Indicators of Compromise','Threat Hunting Methodology','SIEM &amp; Log Analysis','Malware Triage','Threat Intelligence Platforms','Report Writing &amp; Sharing','Incident Response Integration','Geopolitical Cyber Threats','Threat Modeling','CTI Career Preparation'];
    assert.deepEqual([...threatCurriculum.matchAll(/<span class="mod-name">(.*?)<\/span>/g)].map(match=>match[1]),threatModules);
    const threatTools=(threatIntelligencePage.match(/<section class="s tw">[\s\S]*?<\/section>/)||[])[0]||'';
    assert.deepEqual([...threatTools.matchAll(/<li><i style="background:[^"]+"><\/i>(.*?)<\/li>/g)].map(match=>match[1]),['MISP','Maltego','Shodan','VirusTotal','TheHive','Splunk','Wireshark']);
    assert.equal((threatTools.match(/class="tool-mark"/g)||[]).length,7);
    const threatToolLogos=[...threatTools.matchAll(/<img src="([^"]+)" alt="" width="54" height="54" loading="lazy" decoding="async">/g)].map(match=>match[1]);
    assert.deepEqual(threatToolLogos,['/assets/courses/threat-intelligence-tools/misp.png','/assets/courses/threat-intelligence-tools/maltego.png','/assets/courses/threat-intelligence-tools/shodan.png','/assets/courses/threat-intelligence-tools/virustotal.png','/assets/courses/threat-intelligence-tools/thehive.png','/assets/courses/threat-intelligence-tools/splunk.png','/assets/courses/threat-intelligence-tools/wireshark.png']);
    for(const logo of threatToolLogos){
      r=await fetch(base+logo);
      assert.equal(r.status,200);
      assert.match(r.headers.get('content-type')||'',/image\/png/);
    }
    const threatProjects=(threatIntelligencePage.match(/<div class="pj" id="pj">[\s\S]*?<\/div>/)||[])[0]||'';
    assert.deepEqual([...threatProjects.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]),['Threat Intelligence Report','IOC Hunting Lab','Dark Web Monitoring','APT Attribution Analysis','Threat Landscape Assessment','MITRE ATT&amp;CK Mapping']);
    assert.ok(updatedSitemap.includes('https://www.hackademic.in/course-threat-intelligence.html'));
    assert.ok(threatIntelligencePage.includes('fetch(\'/api/leads\''));
    r=await fetch(base+'/course-cyber-security.html');
    assert.equal(r.status,200);
    const cyberSecurityPage=await r.text();
    assert.ok(cyberSecurityPage.includes('<img class="hero-art" src="/assets/courses/cyber-security.png" alt="Cyber security professional using a digital shield interface" width="900" height="600" loading="eager" fetchpriority="high" decoding="async">'));
    for(const [page,motif] of [[graphicDesignPage,'graphic-design'],[webDevelopmentPage,'web-development'],[ccnaPage,'ccna'],[threatIntelligencePage,'threat-intelligence'],[cyberSecurityPage,'cyber-security']]){
      assert.equal((page.match(/class="course-motif"/g)||[]).length,1);
      assert.ok(page.includes(`data-course-motif="${motif}"`));
      assert.doesNotMatch(page,/class="fl"/);
    }
    const cyberTitle=(cyberSecurityPage.match(/<title>(.*?)<\/title>/)||[])[1]||'';
    const cyberDescription=(cyberSecurityPage.match(/<meta name="description" content="(.*?)">/)||[])[1]||'';
    assert.ok(cyberTitle.length>=50&&cyberTitle.length<=60);
    assert.ok(cyberDescription.length>=140&&cyberDescription.length<=160);
    assert.ok(cyberSecurityPage.includes('<link rel="canonical" href="https://www.hackademic.in/course-cyber-security.html">'));
    assert.ok(cyberSecurityPage.includes('<h1 class="big" id="big" aria-label="Defend">'));
    assert.ok(cyberSecurityPage.includes('<h2 class="sub">Master Program in <u>Cyber Security</u></h2>'));
    assert.equal((cyberSecurityPage.match(/<h1\b/g)||[]).length,1);
    assert.ok(cyberSecurityPage.includes('Duration<b>8 Months</b>'));
    assert.ok(cyberSecurityPage.includes('<span data-n="18" data-s="+">18+</span>'));
    assert.ok(cyberSecurityPage.includes('<span data-n="9" data-s="+">9+</span>'));
    assert.ok(cyberSecurityPage.includes('<span class="lifetime">Lifetime</span></b></div><small>LMS Access</small>'));
    assert.ok(cyberSecurityPage.includes('<footer class="site-footer">'));
    assert.ok(cyberSecurityPage.includes('<option>Master Program in Cyber Security</option>'));
    const cyberSchemas=[...cyberSecurityPage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match=>JSON.parse(match[1]));
    assert.deepEqual(cyberSchemas.map(schema=>schema['@type']),['BreadcrumbList','Course']);
    assert.equal(cyberSchemas[1].timeRequired,'P8M');
    const cyberNavigation=(cyberSecurityPage.match(/<nav id="nav"[\s\S]*?<\/nav>/)||[])[0]||'';
    assert.ok(cyberNavigation.includes('href="/courses.html">&larr; Back to Courses</a>'));
    const cyberCurriculum=(cyberSecurityPage.match(/<section class="s cu"[\s\S]*?<\/section>/)||[])[0]||'';
    const cyberModules=['Introduction to Cybersecurity','Networking Fundamentals','Operating System Security','Cryptography &amp; PKI','Web Application Security','Network Security &amp; Firewalls','Ethical Hacking Methodology','Vulnerability Assessment','Penetration Testing','Malware Analysis','Incident Response','SIEM &amp; Log Analysis','Cloud Security','Mobile Security','IoT Security','Cyber Law &amp; Compliance','Security Audit &amp; Governance','Career Preparation &amp; Soft Skills'];
    assert.deepEqual([...cyberCurriculum.matchAll(/<span class="mod-name">(.*?)<\/span>/g)].map(match=>match[1]),cyberModules);
    const cyberTools=(cyberSecurityPage.match(/<section class="s tw">[\s\S]*?<\/section>/)||[])[0]||'';
    assert.deepEqual([...cyberTools.matchAll(/<li><i style="background:[^"]+"><\/i>(.*?)<\/li>/g)].map(match=>match[1]),['Kali Linux','Wireshark','Metasploit','Nmap','Burp Suite','John the Ripper','Sqlmap','Snort','Nessus']);
    assert.equal((cyberTools.match(/class="tool-mark"/g)||[]).length,9);
    const cyberToolLogos=[...cyberTools.matchAll(/<img src="([^"]+)" alt="" width="54" height="54" loading="lazy" decoding="async">/g)].map(match=>match[1]);
    assert.deepEqual(cyberToolLogos,['/assets/courses/cyber-security-tools/wireshark.png','/assets/courses/cyber-security-tools/metasploit.png','/assets/courses/cyber-security-tools/nmap.png','/assets/courses/cyber-security-tools/burp-suite.png','/assets/courses/cyber-security-tools/john-the-ripper.png','/assets/courses/cyber-security-tools/sqlmap.png','/assets/courses/cyber-security-tools/snort.png','/assets/courses/cyber-security-tools/nessus.png']);
    for(const logo of cyberToolLogos){
      r=await fetch(base+logo);
      assert.equal(r.status,200);
      assert.match(r.headers.get('content-type')||'',/image\/png/);
    }
    const cyberProjects=(cyberSecurityPage.match(/<div class="pj" id="pj">[\s\S]*?<\/div>/)||[])[0]||'';
    assert.deepEqual([...cyberProjects.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]),['Phishing Simulation Setup','Network Intrusion Detection','Malware Analysis Lab','Security Audit Report','Incident Response Drill','SIEM Dashboard Setup']);
    assert.ok(cyberSecurityPage.includes('fetch(\'/api/leads\''));
    assert.ok((await (await fetch(base+'/sitemap.xml')).text()).includes('https://www.hackademic.in/course-cyber-security.html'));
    r=await fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Design Course Test',email:'design-course@example.com',phone:'9876543210',interest:'Master in Graphic Designing',message:'Course page inquiry test'})});
    assert.equal(r.status,201);
    assert.equal(one("SELECT interest FROM leads WHERE email='design-course@example.com'").interest,'Master in Graphic Designing');
    const reviewsSection=(home.match(/<!-- TESTIMONIALS -->([\s\S]*?)<!-- CTA -->/)||[])[1]||'';
    for(const student of ['Harsh Rawat','Pravin Sabale','Priti Prajapati','Suraj Rawat','Dev Saini'])assert.ok(reviewsSection.includes(`<b>${student}</b>`));
    assert.equal((reviewsSection.match(/class="quote"/g)||[]).length,10);
    assert.equal((reviewsSection.match(/aria-label="5 out of 5 stars"/g)||[]).length,10);
    assert.ok(!reviewsSection.includes('Rohit Sharma'));
    r=await fetch(base+'/certificate.html');
    assert.equal(r.status,200);
    const certificatePage=await r.text();
    assert.ok(certificatePage.includes('id="certificate-form"'));
    assert.ok(certificatePage.includes('Certificate Verification Portal'));
    assert.ok(certificatePage.includes('aria-label="Certificate verification steps"'));
    assert.equal((certificatePage.match(/class="verify-step"/g)||[]).length,3);
    assert.ok(certificatePage.includes('<h2>Enter Certificate ID</h2>'));
    assert.ok(certificatePage.includes('Paste your unique certificate ID below for instant verification'));
    assert.ok(certificatePage.includes('placeholder="e.g., HACK-2026-XXXX"'));
    assert.ok(certificatePage.includes('aria-label="Verification assurances"'));
    assert.ok(certificatePage.includes('<footer class="site-footer">'));
    assert.ok(certificatePage.includes('<span class="site-footer__contact-icon" aria-hidden="true"><svg viewBox="0 0 24 24"'));
    assert.equal((certificatePage.match(/class="faq-item/g)||[]).length,5);
    assert.equal((certificatePage.match(/<li><a href=/g)||[]).length,9);
    const socialLinks=(certificatePage.match(/<div class="site-footer__social-links">([\s\S]*?)<\/div>/)||[])[1]||'';
    assert.equal((socialLinks.match(/<a href=/g)||[]).length,4);
    assert.equal((socialLinks.match(/<svg\b/g)||[]).length,4);
    assert.ok(certificatePage.includes('href="/portal.html">Admin Login</a>'));
    assert.ok(certificatePage.includes('href="/portal.html">Manager Panel</a>'));
    assert.ok(!certificatePage.includes('href="/portal.html">Student Login</a>'));
    assert.ok(certificatePage.indexOf('href="/terms.html"')<certificatePage.indexOf('href="/privacy-policy.html"'));
    assert.ok(!certificatePage.includes('Newsletter'));
    const cyberCrimeLink='<a href="https://cybercrime.gov.in/home">Report a Cyber Crime</a>';
    for(const [pageName,page] of [['home',home],['services',servicesPage],['quotation',quotationPage],['certificate',certificatePage],['portal',portal],['careers',careers]]){
      assert.ok(page.includes(cyberCrimeLink),`Missing official cybercrime link in ${pageName} footer`);
      assert.ok(!page.includes('mailto:info@hackademic.in?subject=Report%20a%20Cyber%20Crime'),`Found old cybercrime mailto in ${pageName} footer`);
    }
    r=await fetch(base+'/terms.html');
    assert.equal(r.status,200);
    const termsPage=await r.text();
    assert.ok(termsPage.includes('<h1>Hackademic Terms and Conditions</h1>'));
    assert.ok(termsPage.includes('<h2>12. Contact Information</h2>'));
    assert.ok(termsPage.includes('governed by and construed in accordance with the laws of India'));
    r=await fetch(base+'/privacy-policy.html');
    assert.equal(r.status,200);
    const privacyPage=await r.text();
    assert.ok(privacyPage.includes('<h1>Hackademic Privacy Policy</h1>'));
    assert.ok(privacyPage.includes('<h2>11. Contact Us</h2>'));
    assert.ok(privacyPage.includes('Certificate records are retained indefinitely for verification purposes.'));
    for(const pagePath of ['/','/404.html','/about.html','/blog.html','/careers.html','/certificate.html','/contact.html','/course-ccna.html','/course-cyber-security.html','/course-graphic-design.html','/course-threat-intelligence.html','/course-web-development.html','/courses.html','/enroll.html','/portal.html','/privacy-policy.html','/quotation.html','/services.html','/terms.html']){
      const pageResponse=await fetch(base+pagePath);
      assert.equal(pageResponse.status,200,`Unable to load ${pagePath}`);
      const page=await pageResponse.text();
      const footer=(page.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)||[])[0]||'';
      assert.ok(footer,`${pagePath} is missing the shared footer`);
      for(const section of ['class="site-footer__grid"','class="site-footer__description"','class="site-footer__social-links"','aria-label="Quick links"','class="site-footer__contact"','HACKADEMIC. All rights reserved.']){
        assert.ok(footer.includes(section),`${pagePath} footer is missing ${section}`);
      }
    }

    r=await fetch(base+'/api/certificates/verify?code=ha-2026-001');
    assert.equal(r.status,200);
    const verification=await r.json();
    assert.equal(verification.valid,true);
    assert.equal(verification.certificate.code,'HA-2026-001');
    assert.equal(verification.certificate.name,'Demo Student');
    assert.equal(verification.certificate.course,'Ethical Hacking & Cyber Security');
    r=await fetch(base+'/api/certificates/verify?code=unknown');
    assert.deepEqual(await r.json(),{valid:false});
    r=await fetch(base+'/api/certificates/verify');
    assert.equal(r.status,400);

    const quotation={
      companyName:'Acme Systems',
      name:'Aarav Sharma',
      designation:'IT Manager',
      email:'AARAV@example.com',
      phone:'9876543210',
      service:'Security Audit & Assessment',
      estimatedBudget:'₹1,00,000 - ₹5,00,000',
      timeline:'1 Month',
      projectDescription:'We need an assessment of our customer portal and a clear remediation plan.',
      additionalRequirements:'Please include a follow-up discussion.'
    };
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(quotation)});
    assert.equal(r.status,201);
    assert.deepEqual(await r.json(),{ok:true,message:'Quotation request received'});
    const savedQuotation=one("SELECT * FROM leads WHERE source='quotation'");
    assert.equal(savedQuotation.name,'Aarav Sharma');
    assert.equal(savedQuotation.email,'aarav@example.com');
    assert.equal(savedQuotation.phone,'9876543210');
    assert.equal(savedQuotation.interest,'Security Audit & Assessment');
    assert.ok(savedQuotation.message.includes('Company Name: Acme Systems'));
    assert.ok(savedQuotation.message.includes('Estimated Budget: ₹1,00,000 - ₹5,00,000'));
    assert.ok(savedQuotation.message.includes('Project Description: We need an assessment'));
    assert.ok(savedQuotation.message.includes('Additional Requirements: Please include a follow-up discussion.'));
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...quotation,phone:'12345'})});
    assert.equal(r.status,400);
    assert.equal((await r.json()).error,'Phone must be 10 digits');
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...quotation,service:'Unknown service'})});
    assert.equal(r.status,400);
    assert.equal((await r.json()).error,'Invalid service');
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...quotation,estimatedBudget:'Unlimited'})});
    assert.equal(r.status,400);
    assert.equal((await r.json()).error,'Invalid estimated budget');
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...quotation,timeline:'Someday'})});
    assert.equal(r.status,400);
    assert.equal((await r.json()).error,'Invalid timeline');
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...quotation,projectDescription:Array(201).fill('requirement').join(' ')})});
    assert.equal(r.status,400);
    assert.equal((await r.json()).error,'Project Description must not exceed 200 words');
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...quotation,additionalRequirements:Array(201).fill('requirement').join(' ')})});
    assert.equal(r.status,400);
    assert.equal((await r.json()).error,'Additional Requirements must not exceed 200 words');
    assert.equal(Number(one("SELECT COUNT(*) AS count FROM leads WHERE source='quotation'").count),1);

    r=await fetch(base+'/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:'admin@hackademic.demo',password:'HackademicDemo!2026'})
    });
    assert.equal(r.status,200);
    const adminLogin=await r.json(),adminCookie=r.headers.get('set-cookie').split(';')[0];
    r=await fetch(base+'/api/dashboard',{headers:{cookie:adminCookie}});
    assert.equal(r.status,200);
    assert.deepEqual((await r.json()).stats,{courses:6,services:5,teamMembers:1,certificates:1,blogPosts:0,applications:0});
    r=await fetch(base+'/api/services');
    assert.equal((await r.json()).items.length,5);
    r=await fetch(base+'/api/blog');
    assert.equal((await r.json()).items.length,0);

    const servicePayload={title:'Managed Cloud Support',slug:'managed-cloud-support',description:'Cloud configuration and support for growing teams.',published:1};
    r=await fetch(base+'/api/manage/service',{method:'POST',headers:{cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':adminLogin.csrf},body:JSON.stringify(servicePayload)});
    assert.equal(r.status,201);
    const serviceId=Number(one('SELECT id FROM services WHERE slug=?',servicePayload.slug).id);
    r=await fetch(base+'/api/services');
    assert.ok((await r.json()).items.some(item=>item.id===serviceId));
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...quotation,service:servicePayload.title})});
    assert.equal(r.status,201);
    r=await fetch(base+'/api/manage/service',{method:'POST',headers:{cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':adminLogin.csrf},body:JSON.stringify({...servicePayload,id:serviceId,published:0})});
    assert.equal(r.status,200);
    r=await fetch(base+'/api/services');
    assert.ok(!(await r.json()).items.some(item=>item.id===serviceId));
    r=await fetch(base+'/api/quotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...quotation,service:servicePayload.title})});
    assert.equal(r.status,400);
    r=await fetch(base+'/api/manage/service/'+serviceId,{method:'DELETE',headers:{cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':adminLogin.csrf},body:'{}'});
    assert.equal(r.status,200);

    const blogPayload={title:'Safer Study Habits',slug:'safer-study-habits',excerpt:'A short guide for students.',content:'Learn in authorised practice environments.',status:'draft'};
    r=await fetch(base+'/api/manage/blog',{method:'POST',headers:{cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':adminLogin.csrf},body:JSON.stringify(blogPayload)});
    assert.equal(r.status,201);
    const postId=Number(one('SELECT id FROM blog_posts WHERE slug=?',blogPayload.slug).id);
    r=await fetch(base+'/api/blog');
    assert.equal((await r.json()).items.length,0);
    r=await fetch(base+'/api/manage/blog',{method:'POST',headers:{cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':adminLogin.csrf},body:JSON.stringify({...blogPayload,id:postId,status:'published'})});
    assert.equal(r.status,200);
    r=await fetch(base+'/api/blog');
    assert.equal((await r.json()).items[0].slug,blogPayload.slug);
    r=await fetch(base+'/api/blog/'+blogPayload.slug);
    assert.equal((await r.json()).post.content,blogPayload.content);
    r=await fetch(base+'/api/manage/blog/'+postId,{method:'DELETE',headers:{cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':adminLogin.csrf},body:'{}'});
    assert.equal(r.status,200);

    r=await fetch(base+'/api/manage/lesson',{
      method:'POST',
      headers:{cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':adminLogin.csrf},
      body:JSON.stringify({course_id:course.id,title:'API security class recording',content:'Recording test lesson',video_url:'https://videos.example.test/class-recording.mp4',sort_order:5})
    });
    assert.equal(r.status,201);
    assert.equal(one('SELECT video_url FROM lessons WHERE title=?','API security class recording').video_url,'https://videos.example.test/class-recording.mp4');
    r=await fetch(base+'/api/manage/lesson',{
      method:'POST',
      headers:{cookie:adminCookie,'Content-Type':'application/json','X-CSRF-Token':adminLogin.csrf},
      body:JSON.stringify({course_id:course.id,title:'Invalid video URL',content:'Invalid recording test',video_url:'javascript:alert(1)',sort_order:6})
    });
    assert.equal(r.status,400);
    assert.equal(Number(one('SELECT COUNT(*) AS count FROM lessons WHERE title=?','Invalid video URL').count),0);

    r=await fetch(base+'/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:'student@hackademic.demo',password:'HackademicDemo!2026'})
    });
    assert.equal(r.status,200);
    const studentCookie=r.headers.get('set-cookie').split(';')[0];
    r=await fetch(base+'/api/my/profile',{headers:{cookie:studentCookie}});
    assert.equal(r.status,200);
    const studentProfile=await r.json();
    assert.equal(studentProfile.profile.email,'student@hackademic.demo');
    assert.ok(studentProfile.courses.some(item=>item.title==='Ethical Hacking & Cyber Security'&&item.enrolled_at));
    r=await fetch(base+'/api/dashboard',{headers:{cookie:studentCookie}});
    assert.equal(r.status,200);
    const studentDashboard=await r.json();
    assert.ok(studentDashboard.stats.lecturesAvailable>0);
    assert.ok(studentDashboard.stats.materialsAvailable>0);
    assert.ok(studentDashboard.stats.assignmentsAvailable>0);
    assert.ok(Array.isArray(studentDashboard.recommendations));
    assert.ok(studentDashboard.recommendations.length>0);
    r=await fetch(base+'/api/my/recordings',{headers:{cookie:studentCookie}});
    assert.equal(r.status,200);
    const recordings=(await r.json()).items;
    assert.deepEqual(recordings.map(recording=>recording.title),['API security class recording']);
    assert.equal(recordings[0].video_url,'https://videos.example.test/class-recording.mp4');

    r=await fetch(base+'/api/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:'hr@hackademic.demo',password:'HackademicDemo!2026'})
    });
    assert.equal(r.status,200);
    const login=await r.json(),cookie=r.headers.get('set-cookie').split(';')[0];
    r=await fetch(base+'/api/manage/leads',{headers:{cookie}});
    assert.equal(r.status,200);
    const leads=(await r.json()).items;
    assert.ok(leads.some(x=>x.name==='Sample Enquiry'));
    const lead=leads.find(x=>x.name==='Sample Enquiry');
    r=await fetch(base+'/api/manage/update',{
      method:'POST',
      headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':login.csrf},
      body:JSON.stringify({table:'leads',id:lead.id,status:'contacted'})
    });
    assert.equal(r.status,200);
    r=await fetch(base+'/api/manage/leads',{headers:{cookie}});
    assert.equal((await r.json()).items.find(x=>x.id===lead.id).status,'contacted');
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});
