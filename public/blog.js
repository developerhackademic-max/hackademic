(()=>{
 const menuButton=document.querySelector('.blog-menu-toggle');
 const navigation=document.getElementById('blog-links');
 menuButton.addEventListener('click',()=>{
  const isOpen=menuButton.getAttribute('aria-expanded')==='true';
  menuButton.setAttribute('aria-expanded',String(!isOpen));
  menuButton.setAttribute('aria-label',isOpen?'Open navigation menu':'Close navigation menu');
  menuButton.textContent=isOpen?'☰':'✕';
  navigation.classList.toggle('open',!isOpen);
 });
 navigation.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{
  navigation.classList.remove('open');
  menuButton.setAttribute('aria-expanded','false');
  menuButton.setAttribute('aria-label','Open navigation menu');
  menuButton.textContent='☰';
 }));
 const content=document.getElementById('blogContent');
 const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const formatDate=value=>value?new Date(value).toLocaleDateString():'';
 const showError=error=>{content.innerHTML='<p class="blog-error">Blog posts could not be loaded. Please try again later.</p>';console.error(error)};
 const slug=new URLSearchParams(location.search).get('slug');
 if(slug){
  fetch('/api/blog/'+encodeURIComponent(slug)).then(async response=>{if(!response.ok)throw new Error(response.status===404?'Blog post not found':'Could not load blog post');return response.json()}).then(({post})=>{const paragraphs=post.content.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>`<p>${escapeHtml(line)}</p>`).join('');content.innerHTML=`<a class="blog-back" href="/blog.html">← All posts</a><article class="blog-article"><time>${escapeHtml(formatDate(post.published_at))}</time><h1>${escapeHtml(post.title)}</h1>${post.excerpt?`<p><strong>${escapeHtml(post.excerpt)}</strong></p>`:''}${paragraphs}</article>`}).catch(showError);
  return;
 }
 fetch('/api/blog').then(async response=>{if(!response.ok)throw new Error('Could not load blog posts');return response.json()}).then(({items})=>{if(!Array.isArray(items))throw new Error('Invalid blog response');content.innerHTML=items.length?`<div class="blog-grid">${items.map(post=>`<article class="blog-card"><time>${escapeHtml(formatDate(post.published_at))}</time><h2>${escapeHtml(post.title)}</h2><p>${escapeHtml(post.excerpt)}</p><a class="blog-read" href="/blog.html?slug=${encodeURIComponent(post.slug)}">Read article →</a></article>`).join('')}</div>`:'<section class="blog-empty"><h2>No posts yet</h2><p>New articles will appear here when published.</p></section>'}).catch(showError);
})();
