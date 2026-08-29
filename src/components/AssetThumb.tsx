import { useEffect, useState } from 'react'
import { getAsset } from '../lib/db'

type Props = {
  assetId?: string
  alt?: string
  className?: string
}

export default function AssetThumb({ assetId, alt = '', className = '' }: Props) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let active = true
    if (!assetId) {
      setSrc('')
      return
    }
    getAsset(assetId).then((asset) => {
      if (active) setSrc(asset?.dataUrl || '')
    })
    return () => {
      active = false
    }
  }, [assetId])

  if (!src) return <div className={`asset-placeholder ${className}`} aria-label={alt}>No image</div>
  return <img src={src} alt={alt} className={className} />
}
