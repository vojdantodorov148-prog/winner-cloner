import { ImagePlus, ClipboardPaste } from 'lucide-react'
import { useRef, type DragEvent } from 'react'

type Props = {
  label: string
  hint?: string
  multiple?: boolean
  onFiles: (files: File[]) => void
}

export default function Dropzone({ label, hint, multiple, onFiles }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div
      className="dropzone"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple={multiple}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          if (files.length) onFiles(files)
          e.currentTarget.value = ''
        }}
      />
      <div className="drop-icon"><ImagePlus size={20} /></div>
      <div>
        <strong>{label}</strong>
        <span>{hint || 'Drag & drop or click to upload'}</span>
      </div>
      <ClipboardPaste size={17} className="drop-paste" />
    </div>
  )
}
