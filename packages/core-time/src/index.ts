export interface RationalTime {
  readonly value: bigint;
  readonly timescale: bigint;
}

export interface SerializedRationalTime {
  readonly value: string;
  readonly timescale: string;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);

  while (y !== 0n) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }

  return x === 0n ? 1n : x;
}

export function rationalTime(value: bigint, timescale: bigint): RationalTime {
  if (timescale === 0n) {
    throw new RangeError("RationalTime timescale cannot be zero.");
  }

  const sign = timescale < 0n ? -1n : 1n;
  const normalizedValue = value * sign;
  const normalizedTimescale = timescale * sign;
  const divisor = gcd(normalizedValue, normalizedTimescale);

  return {
    value: normalizedValue / divisor,
    timescale: normalizedTimescale / divisor,
  };
}

export const ZERO_TIME: RationalTime = rationalTime(0n, 1n);

export function addTime(a: RationalTime, b: RationalTime): RationalTime {
  return rationalTime(
    a.value * b.timescale + b.value * a.timescale,
    a.timescale * b.timescale,
  );
}

export function subtractTime(a: RationalTime, b: RationalTime): RationalTime {
  return rationalTime(
    a.value * b.timescale - b.value * a.timescale,
    a.timescale * b.timescale,
  );
}

export function compareTime(a: RationalTime, b: RationalTime): -1 | 0 | 1 {
  const left = a.value * b.timescale;
  const right = b.value * a.timescale;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Returns the exact timeline position for a frame index at a rational FPS.
 * Example: frame 100 at 30000/1001 fps => 100100/30000 seconds.
 */
export function timeFromFrame(
  frame: bigint,
  fpsNumerator: bigint,
  fpsDenominator: bigint = 1n,
): RationalTime {
  if (fpsNumerator <= 0n || fpsDenominator <= 0n) {
    throw new RangeError("FPS numerator and denominator must be positive.");
  }

  return rationalTime(frame * fpsDenominator, fpsNumerator);
}

export function serializeTime(time: RationalTime): SerializedRationalTime {
  return {
    value: time.value.toString(),
    timescale: time.timescale.toString(),
  };
}

export function deserializeTime(time: SerializedRationalTime): RationalTime {
  return rationalTime(BigInt(time.value), BigInt(time.timescale));
}
