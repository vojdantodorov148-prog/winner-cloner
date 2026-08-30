import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Boxes,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileImage,
  FolderDown,
  Gauge,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react'
import AssetThumb from './components/AssetThumb'
import Dropzone from './components/Dropzone'
import Modal from './components/Modal'
import { assetProxyUrl, createGeneration, downloadProxyUrl, getCredits, getTaskStatus } from './lib/api'
import { deleteAsset, getAsset, loadState, optimizeDataUrl, saveAsset, saveState } from './lib/db'
import type { AppState, Job, NavKey, Product, Winner } from './types'

const markets = ['Croatia', 'Greece', 'Hungary', 'Bulgaria', 'Romania', 'Germany', 'United Kingdom', 'United States', 'North Macedonia', 'Custom']
const models = [
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', note: 'Recommended · strongest reference fidelity' },
  { value: 'nano-banana-2', label: 'Nano Banana 2', note: 'Faster Google option' },
  { value: 'gpt-image-2-image-to-image', label: 'GPT Image 2', note: 'Strong text + composition' },
  { value: 'grok-imagine-image-2-0/image-to-image', label: 'Grok Imagine 2.0', note: 'Alternative visual interpretation' },
]

const emptyProduct = (): Product => ({
  id: crypto.randomUUID(),
  name: '',
  brand: '',
  category: '',
  summary: '',
  description: '',
  mechanism: '',
  benefits: '',
  objections: '',
  audience: '',
  offer: '',
  guarantee: '',
  guardrails: '',
  notes: '',
  links: { landing: '', advertorial: '', offerPage: '', checkout: '' },
  assetIds: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

const emptyWinner = (): Winner => ({
  id: crypto.randomUUID(),
  name: '',
  sourceMarket: '',
  platform: 'Meta',
  adType: 'Static ad',
  format: '4:5',
  tags: '',
  notes: '',
  assetId: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [nav, setNav] = useState<NavKey>('generate')
  const [productEditor, setProductEditor] = useState<Product | null>(null)
  const [winnerEditor, setWinnerEditor] = useState<Winner | null>(null)
  const [selectedProductId, setSelectedProductId] = useState(state.products[0]?.id || '')
  const [selectedWinnerId, setSelectedWinnerId] = useState(state.winners[0]?.id || '')
  const [market, setMarket] = useState(state.defaults.market)
  const [outputLanguage, setOutputLanguage] = useState(state.defaults.outputLanguage)
  const [aspectRatio, setAspectRatio] = useState(state.defaults.aspectRatio)
  const [model, setModel] = useState(state.defaults.model)
  const [variations, setVariations] = useState(state.defaults.variations)
  const [cloneStrength, setCloneStrength] = useState(state.defaults.cloneStrength)
  const [extraNotes, setExtraNotes] = useState('')
  const [generating, setGenerating] = useState(false)
  const [toast, setToast] = useState('')
  const [credits, setCredits] = useState<number | null>(null)
  const pollingJobs = useRef(new Set<string>())

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    // Resume unfinished generations after a refresh/reopen instead of leaving
    // them permanently stuck in the Generating state.
    for (const job of state.jobs) {
      if (job.status !== 'generating') continue
      const taskIds = job.results.filter((r) => r.taskId && r.status !== 'success' && r.status !== 'fail').map((r) => r.taskId)
      if (taskIds.length) void pollJob(job.id, taskIds)
    }
    // Only resume the state that existed when the app loaded. New jobs call
    // pollJob directly from generate().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!selectedProductId && state.products[0]) setSelectedProductId(state.products[0].id)
    if (!selectedWinnerId && state.winners[0]) setSelectedWinnerId(state.winners[0].id)
  }, [state.products, state.winners, selectedProductId, selectedWinnerId])

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (productEditor || winnerEditor) return
      const image = Array.from(e.clipboardData?.items || []).find((item) => item.type.startsWith('image/'))
      if (!image) return
      const file = image.getAsFile()
      if (!file) return
      const asset = await saveAsset(file)
      const winner = emptyWinner()
      winner.name = `Pasted winner ${state.winners.length + 1}`
      winner.assetId = asset.id
      setState((s) => ({ ...s, winners: [winner, ...s.winners] }))
      setSelectedWinnerId(winner.id)
      setToast('Pasted image saved as a new winner.')
      setTimeout(() => setToast(''), 2400)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [productEditor, winnerEditor, state.winners.length])

  const selectedProduct = state.products.find((p) => p.id === selectedProductId)
  const selectedWinner = state.winners.find((w) => w.id === selectedWinnerId)
  const latestJob = state.jobs[0]

  const completedCount = state.jobs.filter((j) => j.status === 'completed').length
  const totalResults = state.jobs.reduce((acc, j) => acc + j.results.filter((r) => r.status === 'success').length, 0)

  const persistProduct = (product: Product) => {
    const now = new Date().toISOString()
    const updated = { ...product, updatedAt: now }
    const previous = state.products.find((p) => p.id === updated.id)
    const removedAssets = previous?.assetIds.filter((id) => !updated.assetIds.includes(id)) || []
    setState((s) => {
      const exists = s.products.some((p) => p.id === updated.id)
      return { ...s, products: exists ? s.products.map((p) => p.id === updated.id ? updated : p) : [updated, ...s.products] }
    })
    for (const id of removedAssets) void deleteAsset(id).catch(() => {})
    setSelectedProductId(updated.id)
    setProductEditor(null)
  }

  const persistWinner = (winner: Winner) => {
    const now = new Date().toISOString()
    const updated = { ...winner, updatedAt: now }
    const previous = state.winners.find((w) => w.id === updated.id)
    setState((s) => {
      const exists = s.winners.some((w) => w.id === updated.id)
      return { ...s, winners: exists ? s.winners.map((w) => w.id === updated.id ? updated : w) : [updated, ...s.winners] }
    })
    if (previous?.assetId && previous.assetId !== updated.assetId) void deleteAsset(previous.assetId).catch(() => {})
    setSelectedWinnerId(updated.id)
    setWinnerEditor(null)
  }

  const closeProductEditor = () => {
    if (productEditor) {
      const saved = state.products.find((p) => p.id === productEditor.id)
      const savedIds = new Set(saved?.assetIds || [])
      for (const id of productEditor.assetIds) {
        if (!savedIds.has(id)) void deleteAsset(id).catch(() => {})
      }
    }
    setProductEditor(null)
  }

  const closeWinnerEditor = () => {
    if (winnerEditor) {
      const saved = state.winners.find((w) => w.id === winnerEditor.id)
      if (winnerEditor.assetId && winnerEditor.assetId !== saved?.assetId) void deleteAsset(winnerEditor.assetId).catch(() => {})
    }
    setWinnerEditor(null)
  }

  const removeProduct = async (product: Product) => {
    if (!confirm(`Delete ${product.name || 'this product'}?`)) return
    for (const id of product.assetIds) await deleteAsset(id).catch(() => {})
    setState((s) => ({ ...s, products: s.products.filter((p) => p.id !== product.id) }))
    if (selectedProductId === product.id) setSelectedProductId('')
  }

  const removeWinner = async (winner: Winner) => {
    if (!confirm(`Delete ${winner.name || 'this winner'}?`)) return
    if (winner.assetId) await deleteAsset(winner.assetId).catch(() => {})
    setState((s) => ({ ...s, winners: s.winners.filter((w) => w.id !== winner.id) }))
    if (selectedWinnerId === winner.id) setSelectedWinnerId('')
  }

  const addWinnerFiles = async (files: File[]) => {
    const additions: Winner[] = []
    for (const file of files) {
      const asset = await saveAsset(file)
      additions.push({ ...emptyWinner(), name: file.name.replace(/\.[^.]+$/, ''), assetId: asset.id })
    }
    setState((s) => ({ ...s, winners: [...additions, ...s.winners] }))
    if (additions[0]) setSelectedWinnerId(additions[0].id)
  }

  const generate = async () => {
    if (!selectedWinner || !selectedProduct) {
      setToast('Select a winner and a product first.')
      setTimeout(() => setToast(''), 2600)
      return
    }
    const winnerAsset = await getAsset(selectedWinner.assetId)
    if (!winnerAsset) {
      setToast('Winner image is missing. Re-upload it.')
      setTimeout(() => setToast(''), 2600)
      return
    }
    const productAssets = (await Promise.all(selectedProduct.assetIds.slice(0, 3).map(getAsset))).filter(Boolean)
    if (!productAssets.length) {
      setToast('Add at least one product image to the product profile.')
      setTimeout(() => setToast(''), 2800)
      return
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const job: Job = {
      id,
      winnerId: selectedWinner.id,
      productId: selectedProduct.id,
      market,
      outputLanguage,
      aspectRatio,
      model,
      variations,
      cloneStrength,
      extraNotes,
      status: 'analyzing',
      createdAt: now,
      updatedAt: now,
      results: [],
    }
    setState((s) => ({ ...s, jobs: [job, ...s.jobs] }))
    setGenerating(true)

    try {
      const optimizedImages = await Promise.all([
        optimizeDataUrl(winnerAsset.dataUrl),
        ...productAssets.map((a) => optimizeDataUrl(a!.dataUrl)),
      ]) as string[]
      const [winnerImage, ...productImages] = optimizedImages
      const response = await createGeneration({
        winner: selectedWinner,
        winnerImage,
        product: selectedProduct,
        productImages,
        market,
        outputLanguage,
        aspectRatio,
        model,
        variations,
        cloneStrength,
        extraNotes,
      })
      const results = response.taskIds.map((taskId, idx) => ({ taskId, variation: idx + 1, status: 'waiting' as const }))
      setState((s) => ({
        ...s,
        jobs: s.jobs.map((j) => j.id === id ? { ...j, status: 'generating', results, blueprint: response.blueprint, promptSummary: response.promptSummary, updatedAt: new Date().toISOString() } : j),
      }))
      if (response.warning) {
        setToast(response.warning)
        setTimeout(() => setToast(''), 5000)
      }
      await pollJob(id, response.taskIds)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed'
      setState((s) => ({ ...s, jobs: s.jobs.map((j) => j.id === id ? { ...j, status: 'failed', updatedAt: new Date().toISOString(), promptSummary: message } : j) }))
      setToast(message)
      setTimeout(() => setToast(''), 5000)
    } finally {
      setGenerating(false)
    }
  }

  async function pollJob(jobId: string, taskIds: string[]) {
    if (pollingJobs.current.has(jobId)) return
    pollingJobs.current.add(jobId)
    const deadline = Date.now() + 15 * 60 * 1000
    const pending = new Set(taskIds)
    let delay = 3000

    try {
      while (pending.size && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, delay))
        await Promise.all(Array.from(pending).map(async (taskId) => {
          try {
            const info = await getTaskStatus(taskId)
            setState((s) => ({
              ...s,
              jobs: s.jobs.map((job) => job.id !== jobId ? job : {
                ...job,
                results: job.results.map((result) => result.taskId === taskId ? {
                  ...result,
                  status: info.status,
                  imageUrl: info.imageUrl || result.imageUrl,
                  error: info.error,
                } : result),
                updatedAt: new Date().toISOString(),
              }),
            }))
            if ((info.status === 'success' && info.imageUrl) || info.status === 'fail') pending.delete(taskId)
          } catch {
            // Network/429/5xx status checks are transient. The server and
            // client both retry; keep the task pending instead of failing it.
          }
        }))
        delay = Math.min(10_000, Math.round(delay * 1.35))
      }

      if (pending.size) {
        const timeoutMessage = 'Generation status timed out after 15 minutes. The Kie task may still exist; use Generate again if no result appears.'
        setState((s) => ({
          ...s,
          jobs: s.jobs.map((job) => job.id !== jobId ? job : {
            ...job,
            results: job.results.map((result) => pending.has(result.taskId) ? { ...result, status: 'fail', error: timeoutMessage } : result),
            updatedAt: new Date().toISOString(),
          }),
        }))
      }

      setState((s) => ({
        ...s,
        jobs: s.jobs.map((job) => {
          if (job.id !== jobId) return job
          const normalizedResults = job.results.map((r) => pending.has(r.taskId) && r.status !== 'success' ? { ...r, status: 'fail' as const, error: r.error || 'Generation timed out.' } : r)
          const anySuccess = normalizedResults.some((r) => r.status === 'success' && r.imageUrl)
          const allDone = normalizedResults.every((r) => r.status === 'success' || r.status === 'fail')
          return { ...job, results: normalizedResults, status: allDone && anySuccess ? 'completed' : 'failed', updatedAt: new Date().toISOString() }
        }),
      }))
    } finally {
      pollingJobs.current.delete(jobId)
    }
  }

  const regenerateFromJob = (job: Job) => {
    setSelectedWinnerId(job.winnerId)
    setSelectedProductId(job.productId)
    setMarket(job.market)
    setOutputLanguage(job.outputLanguage)
    setAspectRatio(job.aspectRatio)
    setModel(job.model === 'grok-imagine-image-2-0/image-edit' ? 'grok-imagine-image-2-0/image-to-image' : job.model)
    setVariations(job.variations)
    setCloneStrength(job.cloneStrength)
    setExtraNotes(job.extraNotes)
    setNav('generate')
  }

  const copyGeneratedImage = async (imageUrl: string) => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image copy is not supported in this browser.')
      const pngPromise = (async () => {
        const response = await fetch(assetProxyUrl(imageUrl))
        if (!response.ok) throw new Error('Could not load the image for copy.')
        return ensurePngBlob(await response.blob())
      })()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })])
      setToast('Copied.')
      setTimeout(() => setToast(''), 1800)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not copy image.')
      setTimeout(() => setToast(''), 3200)
    }
  }

  const downloadAllResults = async (job: Job) => {
    const product = state.products.find((p) => p.id === job.productId)
    const successful = job.results.filter((r) => r.status === 'success' && r.imageUrl)
    if (!successful.length) return
    try {
      setToast('Preparing ZIP…')
      const files = await Promise.all(successful.map(async (result) => {
        const response = await fetch(assetProxyUrl(result.imageUrl!))
        if (!response.ok) throw new Error(`Could not load variation ${result.variation}.`)
        const extension = imageExtension(response.headers.get('content-type'))
        return {
          name: `${safeFileName(product?.name || 'creative')}-${safeFileName(job.market)}-v${result.variation}.${extension}`,
          data: new Uint8Array(await response.arrayBuffer()),
        }
      }))
      const zip = buildStoredZip(files)
      const href = URL.createObjectURL(zip)
      const a = document.createElement('a')
      a.href = href
      a.download = `${safeFileName(product?.name || 'creatives')}-${safeFileName(job.market)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 3000)
      setToast('Downloaded.')
      setTimeout(() => setToast(''), 1800)
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Could not prepare ZIP.')
      setTimeout(() => setToast(''), 3200)
    }
  }

  const refreshCredits = async () => {
    try {
      const data = await getCredits()
      setCredits(data.credits)
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not load credits')
      setTimeout(() => setToast(''), 3200)
    }
  }

  const sidebar = [
    { key: 'generate' as const, label: 'Generate', icon: WandSparkles },
    { key: 'winners' as const, label: 'Winners', icon: Images },
    { key: 'products' as const, label: 'Products', icon: Package },
    { key: 'results' as const, label: 'History', icon: LayoutGrid },
    { key: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Zap size={19} fill="currentColor" /></div>
          <div><strong>Winner Cloner</strong></div>
        </div>
        <nav>
          {sidebar.map(({ key, label, icon: Icon }) => (
            <button key={key} className={nav === key ? 'active' : ''} onClick={() => setNav(key)}>
              <Icon size={18} /><span>{label}</span>
              {key === 'results' && state.jobs.some((j) => j.status === 'generating') && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="locked-system minimal-lock">
            <LockKeyhole size={14} />
            <strong>Prompt Master ON</strong>
            <Check size={14} />
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><Zap size={17} fill="currentColor" /> Winner Cloner</div>
          <div className="topbar-spacer" />
          {credits !== null && <div className="credits-pill">{credits.toLocaleString()} credits</div>}
        </header>

        {nav === 'generate' && (
          <GeneratePage
            state={state}
            selectedProductId={selectedProductId}
            selectedWinnerId={selectedWinnerId}
            setSelectedProductId={setSelectedProductId}
            setSelectedWinnerId={setSelectedWinnerId}
            setProductEditor={setProductEditor}
            setWinnerEditor={setWinnerEditor}
            market={market}
            setMarket={setMarket}
            outputLanguage={outputLanguage}
            setOutputLanguage={setOutputLanguage}
            aspectRatio={aspectRatio}
            setAspectRatio={setAspectRatio}
            model={model}
            setModel={setModel}
            variations={variations}
            setVariations={setVariations}
            cloneStrength={cloneStrength}
            setCloneStrength={setCloneStrength}
            extraNotes={extraNotes}
            setExtraNotes={setExtraNotes}
            generate={generate}
            generating={generating}
            latestJob={latestJob}
            copyImage={copyGeneratedImage}
            downloadAll={downloadAllResults}
          />
        )}

        {nav === 'winners' && (
          <WinnersPage
            winners={state.winners}
            addWinnerFiles={addWinnerFiles}
            edit={(winner) => setWinnerEditor({ ...winner })}
            remove={removeWinner}
            select={(winner) => { setSelectedWinnerId(winner.id); setNav('generate') }}
          />
        )}

        {nav === 'products' && (
          <ProductsPage
            products={state.products}
            edit={(product) => setProductEditor({ ...product, links: { ...product.links }, assetIds: [...product.assetIds] })}
            remove={removeProduct}
            create={() => setProductEditor(emptyProduct())}
            select={(product) => { setSelectedProductId(product.id); setNav('generate') }}
          />
        )}

        {nav === 'results' && (
          <ResultsPage
            jobs={state.jobs}
            winners={state.winners}
            products={state.products}
            reuse={regenerateFromJob}
            copyImage={copyGeneratedImage}
            downloadAll={downloadAllResults}
          />
        )}

        {nav === 'settings' && (
          <SettingsPage
            defaults={state.defaults}
            setDefaults={(defaults) => setState((s) => ({ ...s, defaults }))}
            credits={credits}
            refreshCredits={refreshCredits}
          />
        )}
      </main>

      <ProductEditor product={productEditor} setProduct={setProductEditor} onClose={closeProductEditor} onSave={persistProduct} />
      <WinnerEditor winner={winnerEditor} setWinner={setWinnerEditor} onClose={closeWinnerEditor} onSave={persistWinner} />

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function GeneratePage(props: {
  state: AppState
  selectedProductId: string
  selectedWinnerId: string
  setSelectedProductId: (v: string) => void
  setSelectedWinnerId: (v: string) => void
  setProductEditor: (v: Product | null) => void
  setWinnerEditor: (v: Winner | null) => void
  market: string
  setMarket: (v: string) => void
  outputLanguage: string
  setOutputLanguage: (v: string) => void
  aspectRatio: string
  setAspectRatio: (v: string) => void
  model: string
  setModel: (v: string) => void
  variations: number
  setVariations: (v: number) => void
  cloneStrength: number
  setCloneStrength: (v: number) => void
  extraNotes: string
  setExtraNotes: (v: string) => void
  generate: () => void
  generating: boolean
  latestJob?: Job
  copyImage: (url: string) => void | Promise<void>
  downloadAll: (job: Job) => void | Promise<void>
}) {
  const winner = props.state.winners.find((w) => w.id === props.selectedWinnerId)
  const product = props.state.products.find((p) => p.id === props.selectedProductId)

  return (
    <div className="page page-generate minimal-page">
      <div className="minimal-titlebar">
        <h1>Generate</h1>
        <div className="pm-inline"><LockKeyhole size={13} /> Prompt Master ON</div>
      </div>

      <div className="minimal-generate-grid">
        <section className="panel minimal-input-panel">
          <div className="input-section">
            <div className="input-section-title">Winner</div>
            <div className="select-with-action">
              <select value={props.selectedWinnerId} onChange={(e) => props.setSelectedWinnerId(e.target.value)}>
                <option value="">Select winner</option>
                {props.state.winners.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <button className="square-btn" onClick={() => props.setWinnerEditor(emptyWinner())} title="Add winner"><Plus size={18} /></button>
            </div>
            {winner && <div className="compact-selected"><AssetThumb assetId={winner.assetId} alt={winner.name} className="compact-selected-img" /><strong>{winner.name}</strong><button className="icon-btn subtle" onClick={() => props.setWinnerEditor({ ...winner })} title="Edit winner"><Pencil size={15} /></button></div>}
          </div>

          <div className="input-section">
            <div className="input-section-title">Product</div>
            <div className="select-with-action">
              <select value={props.selectedProductId} onChange={(e) => props.setSelectedProductId(e.target.value)}>
                <option value="">Select product</option>
                {props.state.products.map((p) => <option key={p.id} value={p.id}>{p.brand ? `${p.brand} — ` : ''}{p.name}</option>)}
              </select>
              <button className="square-btn" onClick={() => props.setProductEditor(emptyProduct())} title="Add product"><Plus size={18} /></button>
            </div>
            {product && <div className="compact-selected"><AssetThumb assetId={product.assetIds[0]} alt={product.name} className="compact-selected-img" /><strong>{product.name}</strong><button className="icon-btn subtle" onClick={() => props.setProductEditor({ ...product, links: { ...product.links }, assetIds: [...product.assetIds] })} title="Edit product"><Pencil size={15} /></button></div>}
          </div>

          <div className="input-section setup-section">
            <div className="input-section-title">Setup</div>
            <div className="field-grid two compact-fields">
              <Field label="Market"><select value={props.market} onChange={(e) => props.setMarket(e.target.value)}>{markets.map((m) => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Language"><select value={props.outputLanguage} onChange={(e) => props.setOutputLanguage(e.target.value)}><option>Auto — market native</option><option>English</option><option>Croatian</option><option>Greek</option><option>Hungarian</option><option>Bulgarian</option><option>Romanian</option><option>German</option><option>Macedonian</option></select></Field>
              <Field label="Format"><div className="segmented">{['4:5', '1:1', '9:16', '16:9'].map((r) => <button type="button" key={r} className={props.aspectRatio === r ? 'active' : ''} onClick={() => props.setAspectRatio(r)}>{r}</button>)}</div></Field>
              <Field label="Variations"><div className="segmented">{[1, 2, 4, 6].map((v) => <button type="button" key={v} className={props.variations === v ? 'active' : ''} onClick={() => props.setVariations(v)}>{v}</button>)}</div></Field>
            </div>
            <Field label="Model"><select value={props.model} onChange={(e) => props.setModel(e.target.value)}>{models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
            <div className="minimal-range"><div><span>Fidelity</span><strong>{props.cloneStrength}%</strong></div><input type="range" min="35" max="100" value={props.cloneStrength} onChange={(e) => props.setCloneStrength(Number(e.target.value))} /></div>
            <Field label="Notes"><textarea rows={3} value={props.extraNotes} onChange={(e) => props.setExtraNotes(e.target.value)} placeholder="Optional instructions…" /></Field>
          </div>

          <button className="generate-btn minimal-generate-btn" disabled={props.generating || !winner || !product} onClick={props.generate}>
            {props.generating ? <LoaderCircle className="spin" size={18} /> : <Sparkles size={18} />}
            {props.generating ? 'Generating…' : `Generate ${props.variations}`}
          </button>
        </section>

        <OutputPanel job={props.latestJob} product={props.latestJob ? props.state.products.find((p) => p.id === props.latestJob!.productId) : product} copyImage={props.copyImage} downloadAll={props.downloadAll} />
      </div>
    </div>
  )
}

function OutputPanel({ job, product, copyImage, downloadAll }: { job?: Job; product?: Product; copyImage: (url: string) => void | Promise<void>; downloadAll: (job: Job) => void | Promise<void> }) {
  const successes = job?.results.filter((r) => r.status === 'success' && r.imageUrl) || []
  const isActive = !!job && ['queued', 'analyzing', 'prompting', 'generating'].includes(job.status)
  return (
    <section className="panel output-panel">
      <div className="output-head">
        <div><h2>Output</h2>{job && <span className={`simple-status ${job.status}`}>{isActive ? 'Generating' : job.status === 'completed' ? 'Done' : 'Failed'}</span>}</div>
        {job && successes.length > 1 && <button className="secondary-btn compact-action" onClick={() => downloadAll(job)}><FolderDown size={15} /> Download all</button>}
      </div>

      {!job && <div className="output-empty"><ImageIcon size={28} /><span>Output appears here.</span></div>}

      {job && job.status === 'failed' && job.results.length === 0 && <div className="output-error">{job.promptSummary || 'Generation failed.'}</div>}

      {job && job.results.length === 0 && job.status !== 'failed' && <div className="output-empty active"><LoaderCircle className="spin" size={26} /><span>Generating…</span></div>}

      {job && job.results.length > 0 && <div className={`output-grid count-${Math.min(job.results.length, 6)}`}>
        {job.results.map((result) => (
          <div className="output-card" key={result.taskId}>
            <div className="output-image-wrap">
              {result.status === 'success' && result.imageUrl ? <a href={result.imageUrl} target="_blank" rel="noreferrer"><img src={result.imageUrl} alt={`Variation ${result.variation}`} /></a> : <div className="output-placeholder"><LoaderCircle className={result.status === 'fail' ? '' : 'spin'} size={24} /><span>{result.status === 'fail' ? 'Failed' : 'Generating'}</span></div>}
              {job.results.length > 1 && <span className="variation-chip">{result.variation}</span>}
            </div>
            {result.status === 'success' && result.imageUrl && <div className="output-actions">
              <button onClick={() => copyImage(result.imageUrl!)}><Copy size={15} /> Copy</button>
              <a href={downloadProxyUrl(result.imageUrl, `${safeFileName(product?.name || 'creative')}-${safeFileName(job.market)}-v${result.variation}.png`)}><Download size={15} /> Download</a>
            </div>}
            {result.status === 'fail' && <div className="output-card-error">{result.error || 'Failed'}</div>}
          </div>
        ))}
      </div>}
    </section>
  )
}

function WinnersPage({ winners, addWinnerFiles, edit, remove, select }: { winners: Winner[]; addWinnerFiles: (files: File[]) => void; edit: (w: Winner) => void; remove: (w: Winner) => void; select: (w: Winner) => void }) {
  return (
    <div className="page">
      <div className="page-title-row compact"><div><h1>Winners</h1></div></div>
      <Dropzone label="Upload winners" multiple onFiles={addWinnerFiles} />
      {winners.length === 0 ? <EmptyState icon={<Images size={27} />} title="No winners yet" text="Upload a winning ad." /> : (
        <div className="library-grid">
          {winners.map((winner) => (
            <article className="library-card" key={winner.id}>
              <div className="library-image-wrap"><AssetThumb assetId={winner.assetId} alt={winner.name} className="library-image" /><span className="format-chip">{winner.format}</span></div>
              <div className="library-card-body"><strong>{winner.name}</strong>{winner.sourceMarket && <span>{winner.sourceMarket}</span>}</div>
              <div className="library-actions"><button onClick={() => select(winner)}><WandSparkles size={15} /> Use</button><button onClick={() => edit(winner)}><Pencil size={15} /></button><button onClick={() => remove(winner)}><Trash2 size={15} /></button></div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function ProductsPage({ products, edit, remove, create, select }: { products: Product[]; edit: (p: Product) => void; remove: (p: Product) => void; create: () => void; select: (p: Product) => void }) {
  return (
    <div className="page">
      <div className="page-title-row compact"><div><h1>Products</h1></div><button className="primary-btn" onClick={create}><Plus size={17} /> New product</button></div>
      {products.length === 0 ? <EmptyState icon={<Package size={27} />} title="No products yet" text="Create a product profile." action={<button className="primary-btn" onClick={create}><Plus size={17} /> Create product</button>} /> : (
        <div className="product-list">
          {products.map((product) => (
            <article className="product-row" key={product.id}>
              <AssetThumb assetId={product.assetIds[0]} alt={product.name} className="product-row-img" />
              <div className="product-row-main"><div><strong>{product.name}</strong>{product.brand && <span className="brand-chip">{product.brand}</span>}</div><p>{product.summary || product.description || 'No description'}</p></div>
              <div className="row-actions"><button className="primary-quiet" onClick={() => select(product)}><WandSparkles size={15} /> Use</button><button className="icon-btn" onClick={() => edit(product)}><Pencil size={16} /></button><button className="icon-btn danger" onClick={() => remove(product)}><Trash2 size={16} /></button></div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function ResultsPage({ jobs, winners, products, reuse, copyImage, downloadAll }: { jobs: Job[]; winners: Winner[]; products: Product[]; reuse: (j: Job) => void; copyImage: (url: string) => void | Promise<void>; downloadAll: (job: Job) => void | Promise<void> }) {
  const [filter, setFilter] = useState<'all' | 'completed' | 'active'>('all')
  const visible = jobs.filter((j) => filter === 'all' || (filter === 'completed' ? j.status === 'completed' : ['queued', 'analyzing', 'prompting', 'generating'].includes(j.status)))
  return (
    <div className="page">
      <div className="page-title-row compact"><h1>History</h1><div className="segmented small">{(['all', 'completed', 'active'] as const).map((f) => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>)}</div></div>
      {visible.length === 0 ? <EmptyState icon={<LayoutGrid size={27} />} title="No generations" text="Generate a creative first." /> : (
        <div className="jobs-list">
          {visible.map((job) => {
            const winner = winners.find((w) => w.id === job.winnerId)
            const product = products.find((p) => p.id === job.productId)
            const successes = job.results.filter((r) => r.status === 'success' && r.imageUrl)
            return (
              <article className="job-card compact-job" key={job.id}>
                <div className="job-head">
                  <div className="job-head-left"><div className={`job-state-icon ${job.status}`}>{job.status === 'completed' ? <Check size={17} /> : job.status === 'failed' ? <X size={17} /> : <LoaderCircle size={17} className="spin" />}</div><div><strong>{product?.name || 'Deleted product'} <span>×</span> {winner?.name || 'Deleted winner'}</strong><p>{job.market} · {job.aspectRatio} · {job.cloneStrength}%</p></div></div>
                  <div className="job-head-actions">{successes.length > 1 && <button className="icon-btn" onClick={() => downloadAll(job)} title="Download all"><FolderDown size={16} /></button>}<button className="icon-btn" onClick={() => reuse(job)} title="Reuse"><RefreshCw size={16} /></button></div>
                </div>
                {job.status === 'failed' && job.results.length === 0 ? <div className="job-error">{job.promptSummary || 'Generation failed.'}</div> : (
                  <div className="result-strip">
                    {job.results.length === 0 && <div className="result-loading"><LoaderCircle className="spin" size={19} /> Generating…</div>}
                    {job.results.map((result) => (
                      <div className="result-tile" key={result.taskId}>
                        {result.status === 'success' && result.imageUrl ? <img src={result.imageUrl} alt={`Variation ${result.variation}`} /> : <div className="result-placeholder"><LoaderCircle className={result.status !== 'fail' ? 'spin' : ''} size={22} /><span>{result.status === 'fail' ? 'Failed' : 'Generating'}</span></div>}
                        <span className="variation-chip">{result.variation}</span>
                        {result.status === 'success' && result.imageUrl && <div className="result-actions"><button onClick={() => copyImage(result.imageUrl!)}><Copy size={15} /> Copy</button><a href={downloadProxyUrl(result.imageUrl, `${safeFileName(product?.name || 'creative')}-${safeFileName(job.market)}-v${result.variation}.png`)}><Download size={15} /> Download</a></div>}
                      </div>
                    ))}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SettingsPage({ defaults, setDefaults, credits, refreshCredits }: { defaults: AppState['defaults']; setDefaults: (d: AppState['defaults']) => void; credits: number | null; refreshCredits: () => void }) {
  const [draft, setDraft] = useState(defaults)
  useEffect(() => setDraft(defaults), [defaults])
  return (
    <div className="page settings-page">
      <div className="page-title-row compact"><h1>Settings</h1></div>
      <div className="settings-grid">
        <section className="panel settings-card"><div className="panel-head"><h3>Defaults</h3><Settings size={19} /></div>
          <div className="field-grid two">
            <Field label="Market"><select value={draft.market} onChange={(e) => setDraft({ ...draft, market: e.target.value })}>{markets.map((m) => <option key={m}>{m}</option>)}</select></Field>
            <Field label="Language"><select value={draft.outputLanguage} onChange={(e) => setDraft({ ...draft, outputLanguage: e.target.value })}><option>Auto — market native</option><option>English</option><option>Croatian</option><option>Greek</option><option>Hungarian</option><option>Bulgarian</option><option>Romanian</option><option>German</option><option>Macedonian</option></select></Field>
            <Field label="Aspect ratio"><select value={draft.aspectRatio} onChange={(e) => setDraft({ ...draft, aspectRatio: e.target.value })}>{['4:5', '1:1', '9:16', '16:9'].map((v) => <option key={v}>{v}</option>)}</select></Field>
            <Field label="Variations"><select value={draft.variations} onChange={(e) => setDraft({ ...draft, variations: Number(e.target.value) })}>{[1,2,4,6].map((v) => <option key={v}>{v}</option>)}</select></Field>
          </div>
          <Field label="Image model"><select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>{models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></Field>
          <Field label={`Clone strength — ${draft.cloneStrength}%`}><input type="range" min="35" max="100" value={draft.cloneStrength} onChange={(e) => setDraft({ ...draft, cloneStrength: Number(e.target.value) })} /></Field>
          <button className="primary-btn" onClick={() => setDefaults(draft)}><Save size={16} /> Save defaults</button>
        </section>
        <section className="panel settings-card"><div className="panel-head"><h3>Kie.ai</h3><LockKeyhole size={19} /></div>
          <div className="connection-box"><div><span className="green-dot" /><strong>Connected server-side</strong></div></div>
          <div className="credits-card"><span>Account credits</span><strong>{credits === null ? '—' : credits.toLocaleString()}</strong><button className="secondary-btn" onClick={refreshCredits}><RefreshCw size={15} /> Check credits</button></div>
        </section>
        <section className="panel settings-card master-settings compact-master"><div className="system-title"><div className="system-icon"><ShieldCheck size={18} /></div><strong>Prompt Master</strong><span className="on-chip">ON</span></div></section>
      </div>
    </div>
  )
}

function ProductEditor({ product, setProduct, onClose, onSave }: { product: Product | null; setProduct: (p: Product | null) => void; onClose: () => void; onSave: (p: Product) => void }) {
  const [tab, setTab] = useState('Overview')
  if (!product) return null
  const tabs = ['Overview', 'Offer', 'Audience', 'Assets', 'Pages', 'Guardrails', 'Notes']
  const update = <K extends keyof Product>(key: K, value: Product[K]) => setProduct({ ...product, [key]: value })
  const addAssets = async (files: File[]) => {
    const saved = []
    for (const file of files.slice(0, Math.max(0, 8 - product.assetIds.length))) saved.push(await saveAsset(file))
    update('assetIds', [...product.assetIds, ...saved.map((a) => a.id)])
  }
  const removeAsset = (id: string) => {
    update('assetIds', product.assetIds.filter((x) => x !== id))
  }
  return (
    <Modal open title={product.name || 'New product'} onClose={onClose} wide>
      <div className="editor-tabs">{tabs.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Overview' && <div className="editor-section"><div className="field-grid two"><Field label="Product name"><input value={product.name} onChange={(e) => update('name', e.target.value)} placeholder="Alpine Sleep" /></Field><Field label="Brand"><input value={product.brand} onChange={(e) => update('brand', e.target.value)} placeholder="Alpine Patches" /></Field><Field label="Category"><input value={product.category} onChange={(e) => update('category', e.target.value)} placeholder="Sleep patches" /></Field><Field label="One-line summary"><input value={product.summary} onChange={(e) => update('summary', e.target.value)} placeholder="What it is, in one sentence" /></Field></div><Field label="Explain the product in your own words"><textarea rows={7} value={product.description} onChange={(e) => update('description', e.target.value)} placeholder="Describe what it is, who buys it, why they buy it, what makes it different, what you want the ads to communicate..." /></Field><Field label="How it works / mechanism"><textarea rows={4} value={product.mechanism} onChange={(e) => update('mechanism', e.target.value)} /></Field><Field label="Main benefits"><textarea rows={5} value={product.benefits} onChange={(e) => update('benefits', e.target.value)} placeholder="One benefit per line works well." /></Field></div>}
      {tab === 'Offer' && <div className="editor-section"><Field label="Offer"><textarea rows={5} value={product.offer} onChange={(e) => update('offer', e.target.value)} placeholder="Price, old price, 2+1 FREE, bundle structure, shipping..." /></Field><Field label="Guarantee"><textarea rows={4} value={product.guarantee} onChange={(e) => update('guarantee', e.target.value)} placeholder="30-day guarantee, terms, risk reversal..." /></Field></div>}
      {tab === 'Audience' && <div className="editor-section"><Field label="Primary audience / avatar"><textarea rows={6} value={product.audience} onChange={(e) => update('audience', e.target.value)} placeholder="Age, gender, awareness, situation, pains, desired outcome..." /></Field><Field label="Customer objections / fears / critiques"><textarea rows={7} value={product.objections} onChange={(e) => update('objections', e.target.value)} placeholder="Why they hesitate, failed alternatives, Reddit-style objections, trust issues..." /></Field></div>}
      {tab === 'Assets' && <div className="editor-section"><Dropzone label="Add product images" multiple onFiles={addAssets} /><div className="asset-editor-grid">{product.assetIds.map((id, idx) => <div className="asset-edit-card" key={id}><AssetThumb assetId={id} alt={`Product asset ${idx + 1}`} className="asset-edit-img" /><button onClick={() => removeAsset(id)}><X size={15} /></button><span>{idx === 0 ? 'Primary' : `Ref ${idx + 1}`}</span></div>)}</div></div>}
      {tab === 'Pages' && <div className="editor-section"><Field label="Landing page URL"><input value={product.links.landing} onChange={(e) => update('links', { ...product.links, landing: e.target.value })} placeholder="https://..." /></Field><Field label="Advertorial URL"><input value={product.links.advertorial} onChange={(e) => update('links', { ...product.links, advertorial: e.target.value })} placeholder="https://..." /></Field><Field label="Offer page URL"><input value={product.links.offerPage} onChange={(e) => update('links', { ...product.links, offerPage: e.target.value })} placeholder="https://..." /></Field><Field label="Checkout URL"><input value={product.links.checkout} onChange={(e) => update('links', { ...product.links, checkout: e.target.value })} placeholder="https://..." /></Field></div>}
      {tab === 'Guardrails' && <div className="editor-section"><Field label="Claims / words / creative rules to avoid"><textarea rows={10} value={product.guardrails} onChange={(e) => update('guardrails', e.target.value)} placeholder="Unsupported claims, wording you do not want, Meta policy constraints, visual rules, market-specific restrictions..." /></Field></div>}
      {tab === 'Notes' && <div className="editor-section"><Field label="Research & free-form notes"><textarea rows={16} value={product.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Positioning, competitor observations, winning angles, copy notes, ingredient details..." /></Field></div>}
      <div className="editor-footer"><button className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={!product.name.trim()} onClick={() => onSave(product)}><Save size={16} /> Save product</button></div>
    </Modal>
  )
}

function WinnerEditor({ winner, setWinner, onClose, onSave }: { winner: Winner | null; setWinner: (w: Winner | null) => void; onClose: () => void; onSave: (w: Winner) => void }) {
  if (!winner) return null
  const update = <K extends keyof Winner>(key: K, value: Winner[K]) => setWinner({ ...winner, [key]: value })
  const upload = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    const asset = await saveAsset(file)
    setWinner({
      ...winner,
      assetId: asset.id,
      name: winner.name || file.name.replace(/\.[^.]+$/, ''),
    })
  }
  return (
    <Modal open title={winner.name || 'New winner'} onClose={onClose}>
      <div className="editor-section"><Dropzone label={winner.assetId ? 'Replace winner image' : 'Upload winner image'} onFiles={upload} />{winner.assetId && <AssetThumb assetId={winner.assetId} alt={winner.name} className="winner-editor-preview" />}<div className="field-grid two"><Field label="Name"><input value={winner.name} onChange={(e) => update('name', e.target.value)} /></Field><Field label="Source market"><input value={winner.sourceMarket} onChange={(e) => update('sourceMarket', e.target.value)} placeholder="US, Croatia..." /></Field><Field label="Platform"><select value={winner.platform} onChange={(e) => update('platform', e.target.value)}><option>Meta</option><option>TikTok</option><option>Native</option><option>Other</option></select></Field><Field label="Format"><select value={winner.format} onChange={(e) => update('format', e.target.value)}><option>4:5</option><option>1:1</option><option>9:16</option><option>16:9</option><option>Other</option></select></Field></div><Field label="Ad type"><input value={winner.adType} onChange={(e) => update('adType', e.target.value)} placeholder="Native, comparison, editorial, testimonial..." /></Field><Field label="Tags"><input value={winner.tags} onChange={(e) => update('tags', e.target.value)} placeholder="high-impression, native, short-copy..." /></Field><Field label="Notes"><textarea rows={4} value={winner.notes} onChange={(e) => update('notes', e.target.value)} /></Field></div>
      <div className="editor-footer"><button className="secondary-btn" onClick={onClose}>Cancel</button><button className="primary-btn" disabled={!winner.name.trim() || !winner.assetId} onClick={() => onSave(winner)}><Save size={16} /> Save winner</button></div>
    </Modal>
  )
}

function JobDetails({ job, winner, product, onClose }: { job: Job | null; winner?: Winner; product?: Product; onClose: () => void }) {
  if (!job) return null
  return <Modal open title="Generation details" onClose={onClose} wide><div className="job-detail-grid"><div className="detail-source"><span>Winner</span>{winner?.assetId && <AssetThumb assetId={winner.assetId} alt={winner.name} className="detail-source-img" />}<strong>{winner?.name || 'Deleted winner'}</strong></div><div className="detail-info"><div className="detail-kpis"><div><span>Product</span><strong>{product?.name || 'Deleted'}</strong></div><div><span>Market</span><strong>{job.market}</strong></div><div><span>Fidelity</span><strong>{job.cloneStrength}%</strong></div><div><span>Model</span><strong>{models.find((m) => m.value === job.model)?.label || job.model}</strong></div></div><div className="detail-block"><span>Prompt Master summary</span><p>{job.promptSummary || 'Summary will appear after the Prompt Master step completes.'}</p></div>{job.blueprint && <div className="detail-block"><span>Extracted blueprint</span><pre>{JSON.stringify(job.blueprint, null, 2)}</pre></div>}</div></div></Modal>
}

function StepHeader({ number, title, subtitle }: { number: string; title: string; subtitle: string }) { return <div className="step-head"><span>{number}</span><div><strong>{title}</strong><p>{subtitle}</p></div></div> }
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="field"><div className="field-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>{children}</label> }
function BlueprintRow({ label, value, locked }: { label: string; value: string; locked?: boolean }) { return <div className="blueprint-row"><span>{label}</span><strong>{value}</strong>{locked && <LockKeyhole size={13} />}</div> }
function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h3>{title}</h3><p>{text}</p>{action}</div> }


async function ensurePngBlob(blob: Blob) {
  if (blob.type === 'image/png') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare image for copy.')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((out) => out ? resolve(out) : reject(new Error('Could not prepare image for copy.')), 'image/png'))
}

function safeFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'creative'
}

function imageExtension(contentType: string | null) {
  const type = (contentType || '').toLowerCase()
  if (type.includes('webp')) return 'webp'
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg'
  return 'png'
}

type ZipFile = { name: string; data: Uint8Array }
function buildStoredZip(files: ZipFile[]) {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = concatBytes([
      le32(0x04034b50), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(crc), le32(file.data.length), le32(file.data.length), le16(name.length), le16(0), name, file.data,
    ])
    locals.push(local)
    centrals.push(concatBytes([
      le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(crc), le32(file.data.length), le32(file.data.length), le16(name.length), le16(0), le16(0),
      le16(0), le16(0), le32(0), le32(offset), name,
    ]))
    offset += local.length
  }
  const central = concatBytes(centrals)
  const end = concatBytes([
    le32(0x06054b50), le16(0), le16(0), le16(files.length), le16(files.length),
    le32(central.length), le32(offset), le16(0),
  ])
  return new Blob([...locals, central, end], { type: 'application/zip' })
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}
function le16(value: number) { const out = new Uint8Array(2); new DataView(out.buffer).setUint16(0, value, true); return out }
function le32(value: number) { const out = new Uint8Array(4); new DataView(out.buffer).setUint32(0, value >>> 0, true); return out }
function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

export default App
