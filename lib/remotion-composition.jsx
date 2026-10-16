import React from 'react'
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function sceneFrames(scene, fps) {
  return Math.max(1, Math.round((Number(scene?.durationMs) || 4000) / 1000 * fps))
}

function sceneStyle(scene, frame, fps) {
  const duration = sceneFrames(scene, fps)
  const progress = clamp(frame / Math.max(1, duration - 1))
  const preset = scene?.motionPreset || 'subtle_editorial'
  const amount = preset === 'dynamic_editorial' ? 0.06 : preset === 'subtle_editorial' ? 0.025 : 0
  const scale = 1 + amount * progress
  return {
    opacity: interpolate(frame, [0, Math.min(16, duration / 3), Math.max(16, duration - 16), duration], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
    transform: `scale(${scale}) translate(${Math.sin(frame / 22) * (preset === 'dynamic_editorial' ? 0.8 : 0.3)}%, ${Math.cos(frame / 27) * (preset === 'dynamic_editorial' ? 0.6 : 0.2)}%)`
  }
}

function textAnimation(animation, frame, fps) {
  const duration = Math.max(1, fps * 0.65)
  const progress = clamp(frame / duration)
  if (animation === 'slide_left') return { opacity: progress, transform: `translateX(${(1 - progress) * -72}px)` }
  if (animation === 'slide_right') return { opacity: progress, transform: `translateX(${(1 - progress) * 72}px)` }
  if (animation === 'fade_up') return { opacity: progress, transform: `translateY(${(1 - progress) * 36}px)` }
  return { opacity: animation === 'none' ? 1 : progress }
}

function textPosition(position, width, height) {
  if (position === 'top_left') return { left: width * 0.081, top: height * 0.115 }
  if (position === 'center_left') return { left: width * 0.081, top: height * 0.395 }
  return { left: width * 0.081, top: height * 0.64 }
}

function SceneText({scene, site, width, height, frame, fps}) {
  if (scene?.textAnimation === 'none' && !scene?.title && !scene?.body) return null
  const position = textPosition(scene?.textPosition || 'bottom_left', width, height)
  const tone = scene?.textTone === 'dark' ? '#1B1B1B' : '#FFFFFF'
  const animation = textAnimation(scene?.textAnimation || 'fade_up', frame, fps)
  return (
    <div style={{position: 'absolute', left: position.left, top: position.top, width: width * 0.82, color: tone, ...animation, textShadow: tone === '#FFFFFF' ? '0 3px 14px rgba(0,0,0,.42)' : '0 2px 10px rgba(255,255,255,.45)'}}>
      <div style={{width: 132, height: 16, borderRadius: 8, backgroundColor: '#E8B73A', marginBottom: 28}} />
      <div style={{fontFamily: 'Arial, sans-serif', fontSize: Math.max(20, width * 0.0204), fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 26}}>{String(site || 'brand')}</div>
      <div style={{fontFamily: 'Arial, sans-serif', fontSize: Math.max(42, width * 0.0759), lineHeight: 1.06, fontWeight: 700, maxWidth: width * 0.8}}>{scene?.title || 'Reel de marca'}</div>
      {scene?.body ? <div style={{fontFamily: 'Arial, sans-serif', fontSize: Math.max(24, width * 0.0352), lineHeight: 1.25, fontWeight: 400, marginTop: 28, maxWidth: width * 0.78}}>{scene.body}</div> : null}
    </div>
  )
}

function Layer({layer, frame, sceneFrames: duration, fps}) {
  const start = Math.round((Number(layer?.startMs) || 0) / 1000 * fps)
  const end = Math.min(duration, Math.round((Number(layer?.endMs) || duration / fps * 1000) / 1000 * fps))
  if (frame < start || frame > end) return null
  const progress = clamp((frame - start) / Math.max(1, end - start))
  const animation = layer?.animation || 'none'
  const opacity = animation === 'none' ? Number(layer?.opacity ?? 1) : progress * Number(layer?.opacity ?? 1)
  const translateY = animation === 'fade_up' ? (1 - progress) * 40 : 0
  const translateX = animation === 'slide_left' ? (1 - progress) * -80 : animation === 'slide_right' ? (1 - progress) * 80 : 0
  const style = {
    position: 'absolute',
    left: Number(layer?.x) || 0,
    top: Number(layer?.y) || 0,
    width: Number(layer?.width) || 240,
    height: Number(layer?.height) || 120,
    opacity,
    transform: `translate(${translateX}px, ${translateY}px)`,
    transformOrigin: 'center center'
  }
  if (layer?.type === 'text') return <div style={{...style, color: layer.color || '#E8B73A', fontFamily: 'Arial, sans-serif', fontSize: Number(layer.fontSize) || 54, fontWeight: Number(layer.fontWeight) || 700, textAlign: layer.align || 'left', whiteSpace: 'pre-wrap'}}>{layer.text || ''}</div>
  if (layer?.type === 'shape') return <div style={{...style, backgroundColor: layer.color || '#E8B73A', borderRadius: 18}} />
  if (!layer?.dataUrl) return null
  return <Img src={layer.dataUrl} style={{...style, objectFit: 'contain'}} />
}

export function EscarletMotionComposition({scenes = [], site = 'escarlet', logoDataUrl = '', audioDataUrl = '', backgroundColor = '#2A9D8F', width = 1080, height = 1920}) {
  const frame = useCurrentFrame()
  const {fps} = useVideoConfig()
  let offset = 0
  return (
    <AbsoluteFill style={{backgroundColor, overflow: 'hidden'}}>
      {scenes.map((scene, index) => {
        const duration = sceneFrames(scene, fps)
        const from = offset
        offset += duration
        return (
          <Sequence key={scene?.sceneId || index} from={from} durationInFrames={duration}>
            <AbsoluteFill style={{opacity: sceneStyle(scene, frame - from, fps).opacity}}>
              {scene?.backgroundDataUrl ? <Img src={scene.backgroundDataUrl} style={{position: 'absolute', width: '108%', height: '108%', left: '-4%', top: '-4%', objectFit: 'cover', filter: 'blur(24px)', opacity: 0.88}} /> : null}
              {scene?.dataUrl ? <Img src={scene.dataUrl} style={{position: 'absolute', width: '100%', height: '100%', objectFit: scene.fit === 'cover' ? 'cover' : 'contain', transform: sceneStyle(scene, frame - from, fps).transform}} /> : null}
              <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.42) 100%)'}} />
              {scene?.renderMode !== 'flat_slides' ? <SceneText scene={scene} site={site} width={width} height={height} frame={frame - from} fps={fps} /> : null}
              {(scene?.layers || []).map((layer, layerIndex) => <Layer key={layer?.layerId || layerIndex} layer={layer} frame={frame - from} sceneFrames={duration} fps={fps} />)}
              {logoDataUrl && scene?.renderMode !== 'flat_slides' ? <Img src={logoDataUrl} style={{position: 'absolute', right: width * 0.081, bottom: height * 0.0875, width: Math.min(300, width * 0.28), height: 70, objectFit: 'contain'}} /> : null}
            </AbsoluteFill>
          </Sequence>
        )
      })}
      {audioDataUrl ? <Audio src={audioDataUrl} /> : null}
    </AbsoluteFill>
  )
}

