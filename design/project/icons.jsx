// Icons — thin line, 1.5px stroke, rounded caps/joins. Lucide/Phosphor-light feel.
// Uses currentColor for stroke so callers control hue.

const Ic = {};

function makeIcon(d, viewBox = "0 0 24 24") {
  return ({ size = 18, fill, ...rest }) => (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill || "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {d}
    </svg>
  );
}

Ic.Plus = makeIcon(<><path d="M12 5v14M5 12h14"/></>);
Ic.Send = makeIcon(<><path d="M5 12h13M13 6l6 6-6 6"/></>);
Ic.Mic = makeIcon(<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>);
Ic.MicOff = makeIcon(<><path d="M5 11a7 7 0 0 0 11.7 5.2M12 18v3M3 3l18 18"/><path d="M9 5.4A3 3 0 0 1 15 6v4M15 11a3 3 0 0 1-5.1 2.1"/></>);
Ic.Lock = makeIcon(<><rect x="4" y="11" width="16" height="9" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></>);
Ic.Speaker = makeIcon(<><path d="M5 9h3l5-4v14l-5-4H5z"/><path d="M16 9a4 4 0 0 1 0 6"/></>);
Ic.SpeakerOff = makeIcon(<><path d="M5 9h3l5-4v14l-5-4H5z"/><path d="M17 9l4 6M21 9l-4 6"/></>);
Ic.ChevronDown = makeIcon(<><path d="M6 9l6 6 6-6"/></>);
Ic.ChevronRight = makeIcon(<><path d="M9 6l6 6-6 6"/></>);
Ic.Search = makeIcon(<><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></>);
Ic.Edit = makeIcon(<><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M14 6l4 4"/></>);
Ic.Trash = makeIcon(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></>);
Ic.More = makeIcon(<><circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/></>);
Ic.Copy = makeIcon(<><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>);
Ic.Check = makeIcon(<><path d="M5 12l5 5L20 7"/></>);
Ic.X = makeIcon(<><path d="M6 6l12 12M6 18L18 6"/></>);
Ic.Alert = makeIcon(<><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></>);
Ic.Info = makeIcon(<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></>);
Ic.Stop = makeIcon(<><rect x="6" y="6" width="12" height="12" rx="2"/></>);
Ic.Play = makeIcon(<><path d="M8 5l11 7-11 7V5z"/></>);
Ic.Pause = makeIcon(<><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></>);
Ic.Sidebar = makeIcon(<><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></>);
Ic.Menu = makeIcon(<><path d="M4 7h16M4 12h16M4 17h16"/></>);
Ic.Beaker = makeIcon(<><path d="M9 3h6M10 3v6L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 9V3"/><path d="M7 14h10"/></>);
Ic.Stethoscope = makeIcon(<><path d="M5 3v6a4 4 0 0 0 8 0V3"/><path d="M9 13v2a4 4 0 0 0 8 0v-1"/><circle cx="17" cy="13" r="2"/></>);
Ic.Sparkle = makeIcon(<><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z"/></>);
Ic.ArrowDown = makeIcon(<><path d="M12 5v14M6 13l6 6 6-6"/></>);
Ic.Sun = makeIcon(<><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6 6l-1.5-1.5M19.5 19.5L18 18M6 18l-1.5 1.5M19.5 4.5L18 6"/></>);
Ic.Moon = makeIcon(<><path d="M20 14.5A8 8 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></>);

window.Ic = Ic;
