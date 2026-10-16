import React from 'react'
import {Composition, registerRoot} from 'remotion'
import {EscarletMotionComposition} from './remotion-composition.jsx'

function Root() {
  return (
    <Composition
      id="EscarletMotion"
      component={EscarletMotionComposition}
      durationInFrames={240}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{scenes: [], width: 1080, height: 1920, fps: 30}}
      calculateMetadata={({props}) => {
        const fps = Number(props.fps) > 0 ? Number(props.fps) : 30
        const scenes = Array.isArray(props.scenes) ? props.scenes : []
        const durationInFrames = Math.max(1, scenes.reduce((total, scene) => total + Math.max(1, Math.round((Number(scene?.durationMs) || 4000) / 1000 * fps)), 0))
        return {
          fps,
          durationInFrames,
          width: Number(props.width) > 0 ? Number(props.width) : 1080,
          height: Number(props.height) > 0 ? Number(props.height) : 1920
        }
      }}
    />
  )
}

registerRoot(Root)

