/* External Photo Sidebar v1.1.0 (data-URL + Copy to Clipboard) */
const { Plugin, PluginSettingTab, Setting, ItemView, Modal, Notice } = require('obsidian');
const fs = require('fs');
const path = require('path');
const { clipboard, nativeImage, shell } = require('electron');

const VIEW_TYPE = 'external-photo-sidebar-view';
const ICON = 'image-file';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg']);

function mimeOf(ext){
  switch(ext.toLowerCase()){
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.gif': return 'image/gif';
    case '.bmp': return 'image/bmp';
    case '.webp': return 'image/webp';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

async function fileToDataUrl(p){
  const buf = await fs.promises.readFile(p);
  return `data:${mimeOf(path.extname(p))};base64,${buf.toString('base64')}`;
}

async function copyImageToClipboard(filePath){
  try {
    const buf = await fs.promises.readFile(filePath);
    // nativeImage auto-detects PNG/JPEG/BMP/WebP from buffer
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) throw new Error('Unsupported image format or empty buffer');
    clipboard.writeImage(img);
    new Notice('✅ Image copied to clipboard');
  } catch (e) {
    console.error('Copy failed:', e);
    new Notice('❌ Copy failed: ' + (e?.message || 'Unknown error'));
  }
}

class FullImageModal extends Modal{
  constructor(app, filePath){ super(app); this.filePath = filePath; }
  async onOpen(){
    this.modalEl.addClass('eps-modal');

    // Force wide/tall modal (overrides theme limits)
    Object.assign(this.modalEl.style, { width:'92vw', maxWidth:'92vw', height:'92vh', maxHeight:'92vh' });
    Object.assign(this.contentEl.style, { width:'100%', height:'100%', display:'flex', flexDirection:'column' });

    const header = this.contentEl.createDiv({cls:'eps-modal-header'});
    header.createEl('div',{cls:'eps-modal-title',text:path.basename(this.filePath)});
    const btns = header.createDiv({cls:'eps-modal-actions'});

    const copyBtn = btns.createEl('button',{ text:'Copy to Clipboard' });
    copyBtn.addEventListener('click', ()=> copyImageToClipboard(this.filePath));

    const openBtn = btns.createEl('button',{ text:'Open Externally' });
    openBtn.addEventListener('click', ()=> shell.openPath(this.filePath));

    const scroller = this.contentEl.createDiv({cls:'eps-modal-scroller'});
    Object.assign(scroller.style, { flex:'1 1 auto', overflow:'auto' });

    const img = scroller.createEl('img',{cls:'eps-full-image'});
    img.alt = path.basename(this.filePath);
    Object.assign(img.style, { maxWidth:'100%', maxHeight:'100%', objectFit:'contain', display:'block' });
    img.src = await fileToDataUrl(this.filePath);

    // Ctrl + wheel zoom
    let scale = 1;
    scroller.addEventListener('wheel',(e)=>{
      if(!e.ctrlKey) return;
      e.preventDefault();
      scale = Math.max(0.1, Math.min(8, scale + (e.deltaY<0?0.1:-0.1)));
      img.style.transform = `scale(${scale})`;
      img.style.transformOrigin = '0 0';
    });
  }
  onClose(){ this.contentEl.empty(); }
}

class PhotoSidebarView extends ItemView{
  constructor(leaf, plugin){ super(leaf); this.plugin = plugin; this.watcher = null; }
  getViewType(){ return VIEW_TYPE; }
  getDisplayText(){ return 'Photos'; }
  getIcon(){ return ICON; }

  async onOpen(){ this.containerEl.addClass('eps-view'); await this.reload(); this.watch(); }
  async onClose(){ this.unwatch(); this.containerEl.empty(); }

  watch(){
    this.unwatch();
    const dir = this.plugin.settings.folderPath;
    if(!dir || !fs.existsSync(dir)) return;
    try{
      this.watcher = fs.watch(dir,{recursive:this.plugin.settings.recursive??true},()=>this.reload());
    }catch{
      try{ this.watcher = fs.watch(dir,{},()=>this.reload()); }catch(e){ console.error('watch failed', e); }
    }
  }
  unwatch(){ if(this.watcher){ try{ this.watcher.close(); }catch{} this.watcher=null; } }

  readImages(root, recursive){
    const out=[], stack=[root];
    while(stack.length){
      const cur = stack.pop();
      let entries=[];
      try{ entries = fs.readdirSync(cur,{withFileTypes:true}); }catch{ continue; }
      for(const ent of entries){
        const p = path.join(cur, ent.name);
        if(ent.isDirectory()){ if(recursive) stack.push(p); }
        else if(ent.isFile()){
          if(IMAGE_EXTS.has(path.extname(ent.name).toLowerCase())) out.push(p);
        }
      }
    }
    out.sort((a,b)=>a.localeCompare(b));
    return out;
  }

  async reload(){
    this.containerEl.empty();

    const top = this.containerEl.createDiv({cls:'eps-topbar'});
    top.createEl('div',{cls:'eps-title',text:'External Photos'});
    const btn = top.createEl('button',{text:'Refresh'}); btn.onclick = ()=>this.reload();

    const dirInfo = this.containerEl.createDiv({cls:'eps-dirinfo'});
    const dir = this.plugin.settings.folderPath;
    if(!dir){ dirInfo.setText('Set a folder path in settings.'); return; }
    if(!fs.existsSync(dir)){ dirInfo.setText('Folder not found: '+dir); return; }
    dirInfo.setText((this.plugin.settings.recursive?'Recursive: ':'Folder: ')+dir);

    const files = this.readImages(dir, this.plugin.settings.recursive??true);
    const grid = this.containerEl.createDiv({cls:'eps-grid'});
    const thumbSize = Number(this.plugin.settings.thumbSize||96);

    if(files.length===0){ grid.createDiv({text:'No images found.'}); return; }

    for(const f of files){
      const card = grid.createDiv({cls:'eps-card'});
      const img = card.createEl('img',{cls:'eps-thumb'});
      img.alt = path.basename(f);
      img.style.width = `${thumbSize}px`;
      img.style.height = `${Math.round(thumbSize*1.4)}px`; // book-ish aspect
      card.createDiv({cls:'eps-label', text:path.basename(f)});

      // Left-click → open modal
      card.addEventListener('click', ()=> new FullImageModal(this.app, f).open());

      // Right-click → context copy
      card.addEventListener('contextmenu', async (e)=>{
        e.preventDefault();
        await copyImageToClipboard(f);
      });

      // Load thumb
      try{ img.src = await fileToDataUrl(f); }
      catch{ img.replaceWith(createEl('div',{text:'⚠️'})); }
    }
  }
}

class SettingsTab extends PluginSettingTab{
  constructor(app, plugin){ super(app, plugin); this.plugin = plugin; }
  display(){
    const {containerEl} = this; containerEl.empty();
    containerEl.createEl('h2',{text:'External Photo Sidebar'});
    new Setting(containerEl).setName('Folder path (outside vault)')
      .setDesc('Example: C:\\\\Users\\\\YourName\\\\Pictures')
      .addText(t=>t.setPlaceholder('C:\\Users\\Me\\Pictures')
        .setValue(this.plugin.settings.folderPath)
        .onChange(async(v)=>{ this.plugin.settings.folderPath=v.trim(); await this.plugin.saveSettings(); new Notice('Folder path saved'); await this.plugin.activateView(); }));

    new Setting(containerEl).setName('Recursive').setDesc('Include subfolders')
      .addToggle(t=>t.setValue(this.plugin.settings.recursive).onChange(async(v)=>{ this.plugin.settings.recursive=v; await this.plugin.saveSettings(); }));

    new Setting(containerEl).setName('Thumbnail size (px)').setDesc('Grid thumbnail width/height')
      .addSlider(s=>s.setLimits(64, 256, 4)
        .setValue(Number(this.plugin.settings.thumbSize||96))
        .onChange(async(v)=>{ this.plugin.settings.thumbSize=v; await this.plugin.saveSettings(); })
        .setDynamicTooltip());
  }
}

const DEFAULT_SETTINGS = { folderPath:'', recursive:true, thumbSize:96 };

module.exports = class ExternalPhotoPlugin extends Plugin{
  async onload(){
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.registerView(VIEW_TYPE, leaf=>new PhotoSidebarView(leaf, this));
    this.addCommand({id:'open-external-photo-sidebar', name:'Open Photo Sidebar', callback:()=>this.activateView()});
    this.addRibbonIcon(ICON, 'Open Photo Sidebar', ()=>this.activateView());
    this.addSettingTab(new SettingsTab(this.app, this));
    this.app.workspace.onLayoutReady(()=>this.activateView());
  }
  async activateView(){
    const right = this.app.workspace.getRightLeaf(false);
    await right.setViewState({type:VIEW_TYPE, active:true});
    this.app.workspace.revealLeaf(right);
  }
  async saveSettings(){ await this.saveData(this.settings); }
};
