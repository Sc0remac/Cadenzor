# Timeline studio visualization research

To tighten the dedicated project timeline experience we reviewed third-party
libraries that can provide more resilient zooming, grouping, and drag/scroll
capabilities than our bespoke lane renderer. The most relevant options are:

1. **@visjs/vis-timeline** – battle-tested interactive timeline supporting
   nested groups, custom item templates, and dynamic zooming with day, week,
   month, or year scales. It can be mounted inside a React component by
   creating the timeline instance inside a `useEffect` hook and feeding it
   typed datasets.
2. **FullCalendar Resource Timeline** – commercial-friendly extension of
   FullCalendar that renders Gantt-like rows per resource (project facet) with
   elastic time-scales and drag-to-reschedule interactions. Handy if the
   workspace already depends on FullCalendar for calendar views.
3. **Frappe Gantt** – lightweight SVG-based gantt/timeline renderer well suited
   to static dashboards; supports dependencies, progress percentages, and
   custom popovers with minimal setup.

Any of the above can replace our manual canvas over time. `@visjs/vis-timeline`
provides the richest out-of-the-box filtering and zoom granularity, so the new
Timeline Studio has been structured so that the data contract (lane ordering,
entry type classification, and date filtering) can feed directly into whichever
library we adopt next.
