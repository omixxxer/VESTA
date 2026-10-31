import type { ComponentProps, ComponentType } from 'react'
import CounterComponent from './Counter.jsx'
import GradualBlurComponent from './GradualBlur.jsx'
import LatticeLoaderComponent from './LatticeLoader.jsx'
import SpotlightCardComponent from './SpotlightCard.jsx'

// React Bits components are plain JavaScript: TypeScript infers their props from the defaults and so treats
// the props without a default (style, width…) as required. Here every prop is optional, as in the components.
type Optional<Props> = ComponentType<Partial<Props>>

// fontSize also takes a CSS length ('1em' follows the surrounding text), not only pixels.
export const Counter = CounterComponent as unknown as Optional<
  Omit<ComponentProps<typeof CounterComponent>, 'fontSize'> & { fontSize: number | string }
>
export const GradualBlur = GradualBlurComponent as unknown as Optional<ComponentProps<typeof GradualBlurComponent>>
export const LatticeLoader = LatticeLoaderComponent as unknown as Optional<ComponentProps<typeof LatticeLoaderComponent>>
export const SpotlightCard = SpotlightCardComponent as unknown as Optional<ComponentProps<typeof SpotlightCardComponent>>
