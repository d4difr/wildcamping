export default function Contours({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 600 200"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M-10 150 C 80 110, 160 190, 250 140 S 420 80, 610 130"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M-10 110 C 90 70, 170 150, 260 100 S 430 40, 610 90"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M-10 70 C 100 30, 180 110, 270 60 S 440 0, 610 50"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M-10 30 C 110 -10, 190 70, 280 20 S 450 -40, 610 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}
