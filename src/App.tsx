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
import { createGeneration, downloadProxyUrl, getCredits, getTaskStatus } from './lib/api'
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
  const [detailsJob, setDetailsJob] = useState<Job | null>(null)
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
      setNav('results')
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
    { key: 'results' as const, label: 'Results', icon: LayoutGrid },
    { key: 'settings' as const, label: 'Settings', icon: Settings },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Zap size={19} fill="currentColor" /></div>
          <div><strong>Winner Cloner</strong><span>Static Ad Engine</span></div>
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
          <div className="locked-system">
            <div className="locked-icon"><LockKeyhole size={16} /></div>
            <div><strong>Prompt Master</strong><span>Always ON</span></div>
            <Check size={15} />
          </div>
          <div className="sidebar-stats">
            <span>{state.winners.length} winners</span><span>{state.products.length} products</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><Zap size={17} fill="currentColor" /> Winner Cloner</div>
          <div className="topbar-spacer" />
          <div className="status-pill"><span className="green-dot" /> Kie backend ready</div>
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
            openDetails={setDetailsJob}
            reuse={regenerateFromJob}
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
      <JobDetails job={detailsJob} winner={detailsJob ? state.winners.find((w) => w.id === detailsJob.winnerId) : undefined} product={detailsJob ? state.products.find((p) => p.id === detailsJob.productId) : undefined} onClose={() => setDetailsJob(null)} />

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
}) {
  const winner = props.state.winners.find((w) => w.id === props.selectedWinnerId)
  const product = props.state.products.find((p) => p.id === props.selectedProductId)
  const cloneLabel = props.cloneStrength >= 90 ? 'Very close' : props.cloneStrength >= 75 ? 'Controlled variation' : props.cloneStrength >= 55 ? 'Inspired' : 'Loose concept'

  return (
    <div className="page page-generate">
      <div className="page-title-row">
        <div><div className="eyebrow">Production</div><h1>Clone a proven winner</h1><p>Pick the source ad and product. Prompt Master handles the analysis, adaptation and generation instructions behind the scenes.</p></div>
        <div className="pm-badge"><ShieldCheck size={17} /><div><strong>Prompt Master locked ON</strong><span>Every generation runs through the master workflow</span></div></div>
      </div>

      <div className="generate-grid">
        <section className="panel control-panel">
          <StepHeader number="01" title="Source winner" subtitle="The structure and visual logic to preserve" />
          <div className="select-with-action">
            <select value={props.selectedWinnerId} onChange={(e) => props.setSelectedWinnerId(e.target.value)}>
              <option value="">Select a saved winner</option>
              {props.state.winners.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button className="square-btn" onClick={() => props.setWinnerEditor(emptyWinner())}><Plus size={18} /></button>
          </div>
          {winner ? (
            <div className="selected-source">
              <AssetThumb assetId={winner.assetId} alt={winner.name} className="selected-source-img" />
              <div><strong>{winner.name}</strong><span>{winner.sourceMarket || 'Market not tagged'} · {winner.format}</span><button className="text-link" onClick={() => props.setWinnerEditor({ ...winner })}>Edit winner</button></div>
            </div>
          ) : <div className="empty-inline"><ImageIcon size={18} /> Add your first proven static ad in Winners.</div>}

          <div className="divider" />
          <StepHeader number="02" title="Product" subtitle="All saved context is injected automatically" />
          <div className="select-with-action">
            <select value={props.selectedProductId} onChange={(e) => props.setSelectedProductId(e.target.value)}>
              <option value="">Select product</option>
              {props.state.products.map((p) => <option key={p.id} value={p.id}>{p.brand ? `${p.brand} — ` : ''}{p.name}</option>)}
            </select>
            <button className="square-btn" onClick={() => props.setProductEditor(emptyProduct())}><Plus size={18} /></button>
          </div>
          {product ? (
            <div className="selected-product">
              <AssetThumb assetId={product.assetIds[0]} alt={product.name} className="product-thumb" />
              <div className="selected-product-main"><strong>{product.name}</strong><span>{product.summary || 'No summary yet'}</span></div>
              <button className="icon-btn subtle" onClick={() => props.setProductEditor({ ...product, links: { ...product.links }, assetIds: [...product.assetIds] })}><Pencil size={16} /></button>
            </div>
          ) : <div className="empty-inline"><Package size={18} /> Create a product profile with product photos first.</div>}

          <div className="divider" />
          <StepHeader number="03" title="Generation setup" subtitle="Control the output without touching the Prompt Master" />
          <div className="field-grid two">
            <Field label="Market">
              <select value={props.market} onChange={(e) => props.setMarket(e.target.value)}>{markets.map((m) => <option key={m}>{m}</option>)}</select>
            </Field>
            <Field label="Output language">
              <select value={props.outputLanguage} onChange={(e) => props.setOutputLanguage(e.target.value)}>
                <option>Auto — market native</option><option>English</option><option>Croatian</option><option>Greek</option><option>Hungarian</option><option>Bulgarian</option><option>Romanian</option><option>German</option><option>Macedonian</option>
              </select>
            </Field>
            <Field label="Aspect ratio">
              <div className="segmented">{['4:5', '1:1', '9:16', '16:9'].map((r) => <button key={r} className={props.aspectRatio === r ? 'active' : ''} onClick={() => props.setAspectRatio(r)}>{r}</button>)}</div>
            </Field>
            <Field label="Variations">
              <div className="segmented">{[1, 2, 4, 6].map((v) => <button key={v} className={props.variations === v ? 'active' : ''} onClick={() => props.setVariations(v)}>{v}</button>)}</div>
            </Field>
          </div>

          <Field label="Image model">
            <select value={props.model} onChange={(e) => props.setModel(e.target.value)}>{models.map((m) => <option key={m.value} value={m.value}>{m.label} — {m.note}</option>)}</select>
          </Field>

          <div className="range-field">
            <div className="range-head"><label>Clone strength</label><div><strong>{props.cloneStrength}%</strong><span>{cloneLabel}</span></div></div>
            <input type="range" min="35" max="100" value={props.cloneStrength} onChange={(e) => props.setCloneStrength(Number(e.target.value))} />
            <div className="range-labels"><span>More original</span><span>Closer to winner</span></div>
          </div>

          <Field label="Extra instructions" hint="Optional. Prompt Master still stays active.">
            <textarea rows={4} value={props.extraNotes} onChange={(e) => props.setExtraNotes(e.target.value)} placeholder="Example: larger product, shorter supporting copy, woman 45+, more native / less polished..." />
          </Field>

          <button className="generate-btn" disabled={props.generating || !winner || !product} onClick={props.generate}>
            {props.generating ? <LoaderCircle className="spin" size={19} /> : <Sparkles size={19} />}
            {props.generating ? 'Building & generating…' : `Generate ${props.variations} clone${props.variations > 1 ? 's' : ''}`}
          </button>
          <div className="generate-foot"><LockKeyhole size={13} /> Winner analysis → product context → Prompt Master → image model</div>
        </section>

        <section className="preview-column">
          <div className="panel preview-panel">
            <div className="panel-head"><div><div className="eyebrow">Live setup</div><h3>Generation blueprint</h3></div><Gauge size={19} /></div>
            <div className="blueprint-stage">
              {winner ? <AssetThumb assetId={winner.assetId} alt={winner.name} className="blueprint-image" /> : <div className="blueprint-empty"><FileImage size={34} /><span>Your winner preview appears here</span></div>}
              <div className="blueprint-overlay"><span>REFERENCE</span></div>
            </div>
            <div className="blueprint-list">
              <BlueprintRow label="Structure" value={winner ? 'Preserve hierarchy & placement' : 'Waiting for winner'} locked />
              <BlueprintRow label="Product context" value={product ? `${product.name} profile + ${product.assetIds.length} asset${product.assetIds.length === 1 ? '' : 's'}` : 'Waiting for product'} locked />
              <BlueprintRow label="Market" value={`${props.market} · ${props.outputLanguage}`} />
              <BlueprintRow label="Fidelity" value={`${props.cloneStrength}% · ${cloneLabel}`} />
              <BlueprintRow label="Output" value={`${props.variations} × ${props.aspectRatio} · ${models.find((m) => m.value === props.model)?.label}`} />
            </div>
          </div>

          <div className="panel system-panel">
            <div className="system-title"><div className="system-icon"><LockKeyhole size={18} /></div><div><strong>Prompt Master system</strong><span>Cannot be disabled</span></div><span className="on-chip">ON</span></div>
            <div className="system-flow">
              <span>Analyze winner</span><ChevronRight size={14} /><span>Extract structure</span><ChevronRight size={14} /><span>Adapt offer</span><ChevronRight size={14} /><span>Generate</span>
            </div>
            <p>It preserves the winner’s copy length, visual hierarchy, persuasive flow and CTA logic, then rebuilds the concept around the selected product and market.</p>
          </div>

          {props.latestJob && (
            <div className="panel latest-panel">
              <div><span className={`job-status ${props.latestJob.status}`}>{props.latestJob.status}</span><strong>Latest generation</strong></div>
              <span>{new Date(props.latestJob.createdAt).toLocaleString()}</span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function WinnersPage({ winners, addWinnerFiles, edit, remove, select }: { winners: Winner[]; addWinnerFiles: (files: File[]) => void; edit: (w: Winner) => void; remove: (w: Winner) => void; select: (w: Winner) => void }) {
  return (
    <div className="page">
      <div className="page-title-row compact"><div><div className="eyebrow">Library</div><h1>Winning ads</h1><p>Save proven static ads once, then reuse them across products and markets.</p></div></div>
      <Dropzone label="Upload winning ads" hint="Multiple PNG, JPG or WebP files · you can also paste a screenshot anywhere in the app" multiple onFiles={addWinnerFiles} />
      {winners.length === 0 ? <EmptyState icon={<Images size={27} />} title="No winners yet" text="Add the first proven ad. The source image remains the reference every time you generate a clone." /> : (
        <div className="library-grid">
          {winners.map((winner) => (
            <article className="library-card" key={winner.id}>
              <div className="library-image-wrap"><AssetThumb assetId={winner.assetId} alt={winner.name} className="library-image" /><span className="format-chip">{winner.format}</span></div>
              <div className="library-card-body"><strong>{winner.name}</strong><span>{winner.sourceMarket || 'Unspecified market'} · {winner.platform}</span><div className="tagline">{winner.tags || 'No tags'}</div></div>
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
      <div className="page-title-row compact"><div><div className="eyebrow">Library</div><h1>Products</h1><p>Build the product context once. Edit it anytime; every future Prompt Master run uses the latest profile.</p></div><button className="primary-btn" onClick={create}><Plus size={17} /> New product</button></div>
      {products.length === 0 ? <EmptyState icon={<Package size={27} />} title="No products yet" text="Create a detailed product profile with photos, offer, audience, objections, pages and guardrails." action={<button className="primary-btn" onClick={create}><Plus size={17} /> Create product</button>} /> : (
        <div className="product-list">
          {products.map((product) => (
            <article className="product-row" key={product.id}>
              <AssetThumb assetId={product.assetIds[0]} alt={product.name} className="product-row-img" />
              <div className="product-row-main"><div><strong>{product.name}</strong>{product.brand && <span className="brand-chip">{product.brand}</span>}</div><p>{product.summary || product.description || 'No product description yet.'}</p><div className="row-meta"><span>{product.assetIds.length} images</span><span>{product.offer || 'Offer not set'}</span><span>{product.audience ? 'Audience set' : 'Audience missing'}</span></div></div>
              <div className="row-actions"><button className="primary-quiet" onClick={() => select(product)}><WandSparkles size={15} /> Use</button><button className="icon-btn" onClick={() => edit(product)}><Pencil size={16} /></button><button className="icon-btn danger" onClick={() => remove(product)}><Trash2 size={16} /></button></div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function ResultsPage({ jobs, winners, products, openDetails, reuse }: { jobs: Job[]; winners: Winner[]; products: Product[]; openDetails: (j: Job) => void; reuse: (j: Job) => void }) {
  const [filter, setFilter] = useState<'all' | 'completed' | 'active'>('all')
  const visible = jobs.filter((j) => filter === 'all' || (filter === 'completed' ? j.status === 'completed' : ['queued', 'analyzing', 'prompting', 'generating'].includes(j.status)))
  return (
    <div className="page">
      <div className="page-title-row compact"><div><div className="eyebrow">Output</div><h1>Results</h1><p>Every run stays grouped by winner, product, market and generation settings.</p></div><div className="segmented small">{(['all', 'completed', 'active'] as const).map((f) => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>)}</div></div>
      {visible.length === 0 ? <EmptyState icon={<LayoutGrid size={27} />} title="No generations here" text="Generate your first clone from the Generate tab." /> : (
        <div className="jobs-list">
          {visible.map((job) => {
            const winner = winners.find((w) => w.id === job.winnerId)
            const product = products.find((p) => p.id === job.productId)
            const successes = job.results.filter((r) => r.status === 'success')
            return (
              <article className="job-card" key={job.id}>
                <div className="job-head">
                  <div className="job-head-left"><div className={`job-state-icon ${job.status}`}>{job.status === 'completed' ? <Check size={17} /> : job.status === 'failed' ? <X size={17} /> : <LoaderCircle size={17} className={job.status === 'generating' ? 'spin' : ''} />}</div><div><strong>{product?.name || 'Deleted product'} <span>×</span> {winner?.name || 'Deleted winner'}</strong><p>{job.market} · {job.aspectRatio} · {models.find((m) => m.value === job.model)?.label || job.model} · {job.cloneStrength}% fidelity</p></div></div>
                  <div className="job-head-actions"><span>{new Date(job.createdAt).toLocaleString()}</span><button className="icon-btn" onClick={() => reuse(job)} title="Reuse settings"><RefreshCw size={16} /></button><button className="icon-btn" onClick={() => openDetails(job)}><MoreHorizontal size={17} /></button></div>
                </div>
                {job.status === 'failed' && job.results.length === 0 ? <div className="job-error">{job.promptSummary || 'The generation could not start.'}</div> : (
                  <div className="result-strip">
                    {job.results.length === 0 && <div className="result-loading"><LoaderCircle className="spin" size={19} /> Prompt Master is analyzing the winner and product…</div>}
                    {job.results.map((result) => (
                      <div className="result-tile" key={result.taskId}>
                        {result.status === 'success' && result.imageUrl ? <img src={result.imageUrl} alt={`Variation ${result.variation}`} /> : <div className="result-placeholder"><LoaderCircle className={result.status !== 'fail' ? 'spin' : ''} size={22} /><span>{result.status === 'fail' ? 'Failed' : 'Generating'}</span></div>}
                        <span className="variation-chip">V{result.variation}</span>
                        {result.status === 'success' && result.imageUrl && <div className="result-actions"><a href={downloadProxyUrl(result.imageUrl, `${product?.name || 'creative'}-${job.market}-v${result.variation}.png`)}><Download size={15} /> Download</a><a href={result.imageUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a></div>}
                      </div>
                    ))}
                  </div>
                )}
                {successes.length > 0 && <div className="job-footer"><span>{successes.length}/{job.variations} generated</span><button className="text-link" onClick={() => openDetails(job)}>View Prompt Master summary</button></div>}
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
      <div className="page-title-row compact"><div><div className="eyebrow">System</div><h1>Settings</h1><p>Set defaults for new jobs. Prompt Master cannot be turned off.</p></div></div>
      <div className="settings-grid">
        <section className="panel settings-card"><div className="panel-head"><div><h3>Generation defaults</h3><p>Pre-filled each time you open Generate.</p></div><Settings size={19} /></div>
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
        <section className="panel settings-card"><div className="panel-head"><div><h3>Kie.ai connection</h3><p>The API key is read only from Netlify environment variables.</p></div><LockKeyhole size={19} /></div>
          <div className="connection-box"><div><span className="green-dot" /><strong>Server-side key</strong></div><p>Set <code>KIE_API_KEY</code> in Netlify → Site configuration → Environment variables. Never put the key into GitHub or frontend code.</p></div>
          <div className="credits-card"><span>Account credits</span><strong>{credits === null ? '—' : credits.toLocaleString()}</strong><button className="secondary-btn" onClick={refreshCredits}><RefreshCw size={15} /> Check credits</button></div>
        </section>
        <section className="panel settings-card master-settings"><div className="system-title"><div className="system-icon"><ShieldCheck size={18} /></div><div><strong>Prompt Master</strong><span>Core system workflow</span></div><span className="on-chip">LOCKED ON</span></div><p>The master workflow is built into the serverless generation function. Every job analyzes the winner, combines product context, adapts the copy and creates the final image-generation prompt before any image task is submitted.</p><div className="locked-note"><LockKeyhole size={15} /> There is intentionally no OFF switch.</div></section>
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
      {tab === 'Overview' && <div className="editor-section"><div className="field-grid two"><Field label="Product name"><input value={product.name} onChange={(e) => update('name', e.target.value)} placeholder="Alpine Sleep" /></Field><Field label="Brand"><input value={product.brand} onChange={(e) => update('brand', e.target.value)} placeholder="Alpine Patches" /></Field><Field label="Category"><input value={product.category} onChange={(e) => update('category', e.target.value)} placeholder="Sleep patches" /></Field><Field label="One-line summary"><input value={product.summary} onChange={(e) => update('summary', e.target.value)} placeholder="What it is, in one sentence" /></Field></div><Field label="Explain the product in your own words" hint="Write freely. This is high-priority Prompt Master context."><textarea rows={7} value={product.description} onChange={(e) => update('description', e.target.value)} placeholder="Describe what it is, who buys it, why they buy it, what makes it different, what you want the ads to communicate..." /></Field><Field label="How it works / mechanism"><textarea rows={4} value={product.mechanism} onChange={(e) => update('mechanism', e.target.value)} /></Field><Field label="Main benefits"><textarea rows={5} value={product.benefits} onChange={(e) => update('benefits', e.target.value)} placeholder="One benefit per line works well." /></Field></div>}
      {tab === 'Offer' && <div className="editor-section"><Field label="Offer"><textarea rows={5} value={product.offer} onChange={(e) => update('offer', e.target.value)} placeholder="Price, old price, 2+1 FREE, bundle structure, shipping..." /></Field><Field label="Guarantee"><textarea rows={4} value={product.guarantee} onChange={(e) => update('guarantee', e.target.value)} placeholder="30-day guarantee, terms, risk reversal..." /></Field></div>}
      {tab === 'Audience' && <div className="editor-section"><Field label="Primary audience / avatar"><textarea rows={6} value={product.audience} onChange={(e) => update('audience', e.target.value)} placeholder="Age, gender, awareness, situation, pains, desired outcome..." /></Field><Field label="Customer objections / fears / critiques"><textarea rows={7} value={product.objections} onChange={(e) => update('objections', e.target.value)} placeholder="Why they hesitate, failed alternatives, Reddit-style objections, trust issues..." /></Field></div>}
      {tab === 'Assets' && <div className="editor-section"><Dropzone label="Add product reference images" hint="Package, product, logo, ingredients or lifestyle · up to 8 stored images" multiple onFiles={addAssets} /><div className="asset-editor-grid">{product.assetIds.map((id, idx) => <div className="asset-edit-card" key={id}><AssetThumb assetId={id} alt={`Product asset ${idx + 1}`} className="asset-edit-img" /><button onClick={() => removeAsset(id)}><X size={15} /></button><span>{idx === 0 ? 'Primary' : `Ref ${idx + 1}`}</span></div>)}</div><p className="editor-help">The first image is treated as the primary product reference. Prompt Master receives up to the first three product images during generation to keep requests fast and reliable.</p></div>}
      {tab === 'Pages' && <div className="editor-section"><p className="editor-help top">These pages are fetched server-side when possible and added as extra Prompt Master context.</p><Field label="Landing page URL"><input value={product.links.landing} onChange={(e) => update('links', { ...product.links, landing: e.target.value })} placeholder="https://..." /></Field><Field label="Advertorial URL"><input value={product.links.advertorial} onChange={(e) => update('links', { ...product.links, advertorial: e.target.value })} placeholder="https://..." /></Field><Field label="Offer page URL"><input value={product.links.offerPage} onChange={(e) => update('links', { ...product.links, offerPage: e.target.value })} placeholder="https://..." /></Field><Field label="Checkout URL"><input value={product.links.checkout} onChange={(e) => update('links', { ...product.links, checkout: e.target.value })} placeholder="https://..." /></Field></div>}
      {tab === 'Guardrails' && <div className="editor-section"><Field label="Claims / words / creative rules to avoid"><textarea rows={10} value={product.guardrails} onChange={(e) => update('guardrails', e.target.value)} placeholder="Unsupported claims, wording you do not want, Meta policy constraints, visual rules, market-specific restrictions..." /></Field></div>}
      {tab === 'Notes' && <div className="editor-section"><Field label="Research & free-form notes" hint="Anything not covered elsewhere."><textarea rows={16} value={product.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Positioning, competitor observations, winning angles, copy notes, ingredient details..." /></Field></div>}
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

export default App
