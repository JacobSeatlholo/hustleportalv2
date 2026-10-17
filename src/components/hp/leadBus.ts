// Tiny cross-view bus: any view can ask the Leads pipeline to open one contact.
// Mail campaigns uses this so "open contact" on a campaign row jumps straight
// into the lead dialog. The pending slot survives the view switch: the event
// covers the case where LeadsView is already mounted, the slot covers the
// case where it still has to mount after setView('leads').
let pending: string | null = null

export function requestOpenLead(leadId: string) {
  pending = leadId
  try {
    window.dispatchEvent(new CustomEvent('hp:open-lead', { detail: { leadId } }))
  } catch {
    /* the pending slot alone is enough when LeadsView mounts next */
  }
}

export function consumePendingLead(): string | null {
  const v = pending
  pending = null
  return v
}
