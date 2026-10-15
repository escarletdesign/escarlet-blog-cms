export function mergeStoryMedia(storyMedia, instagramMedia) {
  const mediaByUrl = new Map()
  for (const media of [...(storyMedia || []), ...(instagramMedia || [])]) {
    if (!media?.url || mediaByUrl.has(media.url)) continue
    mediaByUrl.set(media.url, media)
    if (mediaByUrl.size === 20) break
  }
  return [...mediaByUrl.values()]
}
