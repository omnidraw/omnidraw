export type TSuggestionRowGeometry = {
  top: number
  height: number
}

export type TArgsSuggestionPageSize = {
  rows: readonly TSuggestionRowGeometry[]
  scrollTop: number
  viewportHeight: number
}

export type TArgsSuggestionScrollTop = {
  currentScrollTop: number
  viewportHeight: number
  optionTop: number
  optionHeight: number
}

export type TArgsSuggestionMenuMaxHeight = {
  boundaryTop: number
  menuBottom: number
  boundaryGap: number
  minHeight: number
  maxHeight: number
}

export function fnClampSuggestionIndex(index: number, count: number) {
  if (count <= 0) {
    return 0
  }

  return Math.min(Math.max(index, 0), count - 1)
}

export function fnGetSuggestionPageSize(args: TArgsSuggestionPageSize) {
  const viewportBottom = args.scrollTop + args.viewportHeight
  const fullyVisibleRows = args.rows.filter((row) => (
    row.top >= args.scrollTop
    && row.top + row.height <= viewportBottom
  )).length

  return Math.max(1, fullyVisibleRows)
}

export function fnGetSuggestionScrollTop(args: TArgsSuggestionScrollTop) {
  if (args.optionTop < args.currentScrollTop) {
    return Math.max(0, args.optionTop)
  }

  const optionBottom = args.optionTop + args.optionHeight
  const viewportBottom = args.currentScrollTop + args.viewportHeight

  if (optionBottom > viewportBottom) {
    return Math.max(0, optionBottom - args.viewportHeight)
  }

  return args.currentScrollTop
}

export function fnGetSuggestionMenuMaxHeight(args: TArgsSuggestionMenuMaxHeight) {
  const availableHeight = args.menuBottom - args.boundaryTop - args.boundaryGap

  if (availableHeight <= 0) {
    return args.maxHeight
  }

  return Math.min(args.maxHeight, Math.max(args.minHeight, availableHeight))
}
