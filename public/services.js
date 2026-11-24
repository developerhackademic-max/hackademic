(()=>{
 const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const anchors={'government-training':'#training','web-development':'#web','graphic-design-ui-ux':'#design','digital-marketing':'#marketing','security-auditing':'#security'};
 const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9l8-5 8 5v11M8 20v-7h8v7M2 20h20"/></svg>';
 const grid=document.getElementById('serviceCards');
 if(!grid)return;
 fetch('/api/services').then(async response=>{
  if(!response.ok)throw new Error('Could not load services');
  const data=await response.json();
  if(!Array.isArray(data.items))throw new Error('Invalid services response');
  grid.innerHTML=data.items.length?data.items.map(service=>`<a class="card" href="${anchors[service.slug]||'#contact'}"><div class="ic">${icon}</div><h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.description)}</p><span class="more">Learn more →</span></a>`).join(''):'<p>No services are available right now.</p>';
  const interestSelect=document.querySelector('#enquiry-form select[name="interest"]');
  if(interestSelect){
   const existing=new Set(Array.from(interestSelect.options,option=>option.value));
   data.items.forEach(service=>{
    if(existing.has(service.title))return;
    const option=document.createElement('option');
    option.value=service.title;
    option.textContent=service.title;
    interestSelect.append(option);
    existing.add(service.title);
   });
  }
  const count=document.getElementById('serviceCount');
  if(count){count.dataset.count=String(data.items.length);count.textContent=String(data.items.length)}
  const structuredData=document.getElementById('serviceStructuredData');
  if(structuredData){const schema=JSON.parse(structuredData.textContent);schema.itemListElement=data.items.map((service,index)=>({'@type':'ListItem',position:index+1,item:{'@type':'Service',name:service.title,provider:{'@type':'Organization',name:'Hackademic Pvt Ltd'},areaServed:['Dehradun','India'],description:service.description}}));structuredData.textContent=JSON.stringify(schema)}
 }).catch(error=>{
  const notice=document.createElement('p');
  notice.className='sub';
  notice.textContent='Services could not be refreshed. Please try again later.';
  grid.insertAdjacentElement('beforebegin',notice);
  console.error(error);
 });
})();
