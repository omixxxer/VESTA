import { useObjectUrl } from './useObjectUrl'

interface GarmentPhotoProps {
  image: Blob
  alt: string
  className?: string
}

export default function GarmentPhoto({ image, alt, className }: GarmentPhotoProps) {
  const imageUrl = useObjectUrl(image)
  if (!imageUrl) return null
  return <img className={className} src={imageUrl} alt={alt} />
}
