# BB appearance

`Parssa/theme.css` preserves the personal light/dark palette and typography, disables sidebar and page-title transitions, and hides navigation shortcuts. Pair it with BB's `navigation/top-list` provider to remove the rail while keeping the thread list and footer Settings button.

Apply from this repository's root:

```sh
bb_theme_dir="$(bb theme dir)"
mkdir -p "$bb_theme_dir/Parssa"
cp themes/Parssa/theme.css "$bb_theme_dir/Parssa/theme.css"
bb theme set Parssa
bb settings ui set sidebar.navigationProvider navigation/top-list
```

This replaces the installed `Parssa` stylesheet. Changes apply live to open BB windows. The CSS targets BB shell attributes and classes verified against the installed app on October 30, 2026; revisit the selectors if a BB update changes the layout.
