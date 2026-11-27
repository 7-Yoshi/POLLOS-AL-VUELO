/**
 * Elementos decorativos SVG fieles a la referencia visual del login de Pollos al Vuelo:
 *  - Fondo exterior crema (#FFF4EF) con curvas suaves en rosa (#F8D6D3), beige y naranja claro.
 *  - Fondo del panel izquierdo: degradado rojo -> rojo anaranjado -> naranja -> amarillo dorado,
 *    onda superior izquierda, sombreado radial suave, nubes cálidas, ondas inferiores y curva divisoria.
 */

export function OuterBackgroundDecor() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      {/* Base cálida crema */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 20% 20%, #FFF7F3 0%, #FFF4EF 52%, #FDEEE6 100%)',
        }}
      />

      {/* Curva rosa decorativa superior izquierda */}
      <svg
        className="absolute -top-6 -left-6 w-[380px] h-[340px] sm:w-[480px] sm:h-[420px]"
        viewBox="0 0 480 420"
        fill="none"
      >
        <path
          d="M0 0H365C330 98 250 185 148 232C94 257 42 272 0 282V0Z"
          fill="#F8D6D3"
          fillOpacity="0.82"
        />
      </svg>

      {/* Curva durazno / beige superior derecha */}
      <svg
        className="absolute -top-4 -right-6 w-[300px] h-[320px] sm:w-[390px] sm:h-[380px]"
        viewBox="0 0 390 380"
        fill="none"
      >
        <path
          d="M150 0H390V320C295 278 212 204 166 102C155 76 149 38 150 0Z"
          fill="#FBE5D4"
          fillOpacity="0.72"
        />
      </svg>

      {/* Curva beige / naranja claro inferior derecha */}
      <svg
        className="absolute -bottom-8 -right-8 w-[420px] h-[320px] sm:w-[540px] sm:h-[390px]"
        viewBox="0 0 540 390"
        fill="none"
      >
        <path
          d="M540 390H118C188 286 286 208 408 164C458 146 502 138 540 134V390Z"
          fill="#F7DFCE"
          fillOpacity="0.85"
        />
        <path
          d="M540 390H250C312 316 392 262 490 234C508 229 524 226 540 224V390Z"
          fill="#F9E9DC"
          fillOpacity="0.65"
        />
      </svg>

      {/* Brillo cálido inferior izquierdo */}
      <div
        className="absolute -bottom-24 -left-24 w-[380px] h-[380px] rounded-full opacity-55"
        style={{
          background: 'radial-gradient(circle, #FBE4D6 0%, rgba(255,244,239,0) 70%)',
        }}
      />
    </div>
  )
}

export function LeftPanelArtwork() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 w-full h-full"
      viewBox="0 0 540 760"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        {/* Degradado principal del panel izquierdo */}
        <linearGradient id="pavLeftGrad" x1="15%" y1="0%" x2="72%" y2="100%">
          <stop offset="0%" stopColor="#B70726" />
          <stop offset="28%" stopColor="#C8102E" />
          <stop offset="56%" stopColor="#E52429" />
          <stop offset="79%" stopColor="#FF781F" />
          <stop offset="100%" stopColor="#FFD129" />
        </linearGradient>

        {/* Acabado rojo brillante esquina superior izquierda */}
        <linearGradient id="pavTopCorner" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#E52429" />
          <stop offset="100%" stopColor="#C8102E" stopOpacity="0.35" />
        </linearGradient>

        {/* Profundidad radial suave detrás del titular (sin bordes duros) */}
        <radialGradient id="pavTitleDepth" cx="42%" cy="24%" r="48%">
          <stop offset="0%" stopColor="#9B051E" stopOpacity="0.40" />
          <stop offset="65%" stopColor="#B70726" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#B70726" stopOpacity="0" />
        </radialGradient>

        {/* Onda amarilla dorada inferior */}
        <linearGradient id="pavGoldWave" x1="0%" y1="0%" x2="100%" y2="60%">
          <stop offset="0%" stopColor="#FFA21F" />
          <stop offset="50%" stopColor="#FFD129" />
          <stop offset="100%" stopColor="#FFB01E" />
        </linearGradient>

        {/* Onda naranja rojiza primer plano inferior derecha */}
        <linearGradient id="pavBottomRedOrange" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#DE401C" />
          <stop offset="100%" stopColor="#F5631E" />
        </linearGradient>

        {/* Nubes cálidas suaves */}
        <linearGradient id="pavCloudGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FF9642" stopOpacity="0.58" />
          <stop offset="100%" stopColor="#FF781F" stopOpacity="0.22" />
        </linearGradient>
      </defs>

      {/* Fondo degradado base */}
      <rect width="540" height="760" fill="url(#pavLeftGrad)" />

      {/* Banda curva roja luminosa en la esquina superior izquierda */}
      <path
        d="M0 0H192C124 68 58 130 0 186V0Z"
        fill="url(#pavTopCorner)"
        opacity="0.75"
      />

      {/* Profundidad radial suave detrás del título blanco */}
      <rect width="540" height="460" fill="url(#pavTitleDepth)" />

      {/* Nube izquierda suave */}
      <path
        d="M-12 518H182C182 496 164 480 142 480C138 480 133 481 129 482C122 453 96 432 65 432C34 432 8 453 1 482C-7 485 -12 498 -12 518Z"
        fill="url(#pavCloudGrad)"
      />

      {/* Nube derecha pequeña */}
      <path
        d="M402 452H522C522 438 511 428 497 428C494 428 491 429 488 430C483 414 468 403 451 403C433 403 418 415 414 432C407 434 402 442 402 452Z"
        fill="url(#pavCloudGrad)"
        opacity="0.72"
      />

      {/* Onda luminosa amarillo dorado detrás de la mascota */}
      <path
        d="M0 622C98 576 222 570 338 602C424 626 490 618 540 594V760H0V622Z"
        fill="url(#pavGoldWave)"
        opacity="0.80"
      />

      {/* Onda media naranja-dorada izquierda */}
      <path
        d="M0 678C92 636 216 634 342 690C418 724 480 738 540 732V760H0V678Z"
        fill="#FFB921"
        opacity="0.72"
      />

      {/* Onda curva naranja rojiza inferior derecha */}
      <path
        d="M230 760C310 704 418 672 540 666V760H230Z"
        fill="url(#pavBottomRedOrange)"
        opacity="0.90"
      />

      {/* Onda dorada luminosa esquina inferior izquierda */}
      <path
        d="M0 718C74 688 168 692 265 734C284 742 302 751 318 760H0V718Z"
        fill="#FFD129"
        opacity="0.90"
      />
    </svg>
  )
}

/**
 * Curva sutil que separa el panel izquierdo del panel derecho (#FFFCFA),
 * fiel a la ligera curvatura de la imagen de referencia.
 */
export function CenterCurveDivider() {
  return (
    <svg
      className="pointer-events-none hidden md:block absolute top-0 -right-[1px] h-full w-[28px] lg:w-[36px] z-10"
      viewBox="0 0 36 760"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M32 0C14 195 4 355 6 500C8 608 17 692 32 760H36V0H32Z"
        fill="#FFFCFA"
      />
    </svg>
  )
}
