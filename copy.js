// Copy buttons on static pages: <button class="copy" data-copy="ID"> copies the text of #ID.
for (const button of document.querySelectorAll('.copy[data-copy]')) button.addEventListener('click', async () => {
  const source = document.getElementById(button.dataset.copy);
  try {
    await navigator.clipboard.writeText(source.textContent);
    button.textContent = '已复制';
  } catch {
    // Clipboard access can be refused; select the text so a manual copy still works.
    getSelection().selectAllChildren(source);
    button.textContent = '请手动复制';
  }
  setTimeout(() => { button.textContent = '复制'; }, 2000);
});
