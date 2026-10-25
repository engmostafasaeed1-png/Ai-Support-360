# Dimmed buttons audit (owner rule, 25 Oct 2026)

Rule: every dimmed button says in one short sentence WHY it is dimmed and WHAT to do next. Built once in `src/components/ui/guided-button.tsx` (shared `Button` props `reason`, `busy`, `hint`) with the reasons in `src/lib/blockedReasons.ts`. Guarded by `src/test/disabledButtonsRule.test.ts`.

## How it behaves

- **Blocked** (`reason`): `aria-disabled="true"` (not the native attribute), dimmed, still focusable; hover, keyboard focus and tap/click open a small popover with the reason, the next step (link or action) and, when several steps apply, "1 of N" / "N more steps". A click never submits. Screen readers get the reason through `aria-describedby`. `hint="inline"` also prints the reason under the button.
- **Busy** (`busy`): native disabled + `aria-busy="true"` and a spinner/"Saving..." label (loading only, nothing to explain).
- **Opt-out**: `/* disabled-ok: <why> */` on the tag, only where the reason is already printed next to the control or a parent passes it down.
- **Server refusals**: codes such as `sla_acceptance_required`, `brd_gate`, `nda_required`, `rate_limited` are mapped in `ERROR_CODE_REASONS` and shown by `friendlyErrorMessage` in the same words plus the next step.

## Totals

| | Count |
|---|---|
| Button-like controls that can be dimmed | 629 (in 282 files) |
| Explained with a reason | 308 (of which 190 also have a loading state) |
| Loading only (busy) | 308 |
| Explicit opt-outs | 13 |
| Unexplained | 0 |

Menu items, switches, checkboxes and inputs are not buttons and keep the native disabled state; where a menu item is dimmed a `BlockedHint` line is shown above it (user actions menu, BRD AI menu).

## Needs an owner decision

1. **Chat message box** (`ChatInput`): the parent only says "disabled"; the box shows the generic "This can no longer be changed". Tell us the real cases (closed request, no consultant yet, NDA) so each shows its own reason.
2. **Submit timesheet**: the reason text comes from the timesheet rules as one sentence; it is shown as is. A structured cause would let the button link to the exact step.
3. **Subscribe (plan checkout)**: "no price yet" can mean still loading or an invalid ticket count; both currently say "Enter a ticket count to see the price."
4. **Activate agreement**: there is no Activate button; an agreement activates automatically once the crew checklist is complete. Confirm that is wanted, or we add a button.
5. **Approve BRD**: the button has no dimmed state today (approval is refused by the server with a readable reason). Confirm no extra pre-condition (for example "read every section") is wanted.
6. **Four-eyes admin approvals** stay hidden (not dimmed) for the admin who started the action, as before.

## Opt-outs

| File | Label | Why |
|---|---|---|
| src/components/admin/SendViaSelector.tsx:43 | (icon) | each unavailable channel lists its reason right below; whole picker follows the parent's disabled |
| src/components/admin/interview-knowledge/VoiceLearningPanel.tsx:303 | {t('voice.learnadmin.remove', 'Remove {{term}}', { term: term.term })} | busy |
| src/components/admin/nda/NDARevokeDialog.tsx:32 | (icon) | busy |
| src/components/chat/ChatInput.tsx:101 | (icon) | pass-through, parent must supply reason; OWNER parent outside batch |
| src/components/chatbot/AIChatbot.tsx:371 | (icon) | busy |
| src/components/client/ClientNDAUpload.tsx:154 | (icon) | the card text itself says "Upload your document below to use it" |
| src/components/client/TicketMatchRequests.tsx:298 | Give more time | busy |
| src/components/consultant/AvailabilityToggle.tsx:162 | "Toggle availability" | busy |
| src/components/favourites/FavouriteButton.tsx:108 | (icon) | busy |
| src/pages/admin/UsersPage.tsx:159 | (icon) | summary-only statistic has no filter action |
| src/pages/client/BusinessProcessesPage.tsx:274 | (icon) | decorative leaf indicator; no children to expand |
| src/pages/client/CompanyProfilePage.tsx:442 | (icon) | busy |
| src/pages/consultant/BusinessProcessesPage.tsx:108 | (icon) | decorative leaf indicator, no child rows to expand |

## Every control

Condition = what the button shows (reason keys from the catalogue) or the loading flag.

### Client (111)

| File | Label | Type | Condition |
|---|---|---|---|
| src/components/client/AssignmentInfoCard.tsx:140 | Send answer | reason + busy | `[!text.trim() && 'type_message_first', hasContact && 'fix_errors_first', tooLong && { key: 'text_too_long', params: { max: ANSWER_MAX_TEXT } }]` |
| src/components/client/BidCounterDialog.tsx:28 | Send counter-offer | reason + busy | `!!problem && { key: hasCounter ? 'already_done' : message.trim().length > 1000 ? 'text_too_long' : 'invalid_value', message: problem }` |
| src/components/client/BidDeadlineDialog.tsx:15 | (icon) | busy | `save.isPending` |
| src/components/client/BidDeclineDialog.tsx:17 | Decline | busy | `decline.isPending` |
| src/components/client/BidQuestions.tsx:19 | Answer | reason + busy | `!answer.trim() && 'answer_required'` |
| src/components/client/BidQuestions.tsx:21 | (icon) | busy | `hide.isPending` |
| src/components/client/ChildTickets.tsx:325 | Create Sub-Ticket | busy | `saving` |
| src/components/client/ClientApprovalCard.tsx:105 | Send again | reason | `[!checklist[0].ok && { key: 'field_required', params: { field: checklist[0].label }, to: checklist[0].to }, !checklist[1].ok && { key: 'select_items_first', to:` |
| src/components/client/ClientApprovalCard.tsx:156 | Cancel | busy | `resubmit.isPending` |
| src/components/client/ClientApprovalCard.tsx:159 | Send | busy | `resubmit.isPending` |
| src/components/client/ClientNDAUpload.tsx:154 | (icon) | opt-out | `the card text itself says "Upload your document below to use it" ` |
| src/components/client/ClientNDAUpload.tsx:186 | (icon) | busy | `uploading` |
| src/components/client/ClientNDAUpload.tsx:192 | (icon) | busy | `uploading` |
| src/components/client/ClientNDAUpload.tsx:210 | Replace NDA | busy | `uploading` |
| src/components/client/ClientSignNDADialog.tsx:155 | (icon) | reason + busy | `[!agreed && 'tick_confirmation_first', (!nameOk \|\| !sigOk) && 'signature_incomplete']` |
| src/components/client/CompanyInvitations.tsx:60 | Accept | busy | `busy === inv.tenant_id` |
| src/components/client/CompanyInvitations.tsx:63 | Decline | busy | `busy === inv.tenant_id` |
| src/components/client/CriticalExtendDialog.tsx:91 | (icon) | reason + busy | `!!problem && { key: 'invalid_value', message: problem }` |
| src/components/client/DirectoryFilterPanel.tsx:228 | Save filters | reason | `!saveName.trim() && { key: 'field_required', params: { field: t('directory.save_name', 'Save these filters as') } }` |
| src/components/client/onboarding/ClientOnboarding.tsx:235 | onboarding.back | reason | `currentStep === 0 && 'first_page'` |
| src/components/client/onboarding/ClientOnboarding.tsx:240 | onboarding.next | reason | `!canNext() && 'select_items_first'` |
| src/components/client/onboarding/ClientOnboarding.tsx:245 | (icon) | busy | `submitting` |
| src/components/client/OtherCompanyProfile.tsx:115 | Save company details | reason + busy | `[!isOwnerOrAdmin && { key: 'permission_missing', params: { role: t('company_profile_page.non_owner', 'non-owner') } }, !changed && 'nothing_changed', !name.trim` |
| src/components/client/PlanCheckoutDialog.tsx:101 | (icon) | reason + busy | `[ !!quoteErr && { key: 'invalid_value', message: quoteErr }, !!applied && !!quote?.voucher_error && { key: 'invalid_value', message: quote.voucher_error }, !quo` |
| src/components/client/RequestBidDialog.tsx:394 | Close Bidding | busy | `closing` |
| src/components/client/RequestBidDialog.tsx:466 | Open for Public Bids | busy | `saving` |
| src/components/client/RequestBidDialog.tsx:508 | Send Private Bid Invitations | busy | `saving` |
| src/components/client/RequestBidDialog.tsx:568 | Send Private Bid Invitations | busy | `saving` |
| src/components/client/ScheduleMeetingDialog.tsx:417 | Add | reason | `externalEmails.length >= MAX_EXTERNAL_INVITEES && { key: 'limit_reached', params: { max: MAX_EXTERNAL_INVITEES } }` |
| src/components/client/ScheduleMeetingDialog.tsx:642 | Schedule Meeting | reason + busy | `problems.length > 0 && { key: 'fix_errors_first', message: problems.join(' ') }` |
| src/components/client/SendMatchRequestDialog.tsx:344 | (icon) | busy | `aiLoading` |
| src/components/client/SendMatchRequestDialog.tsx:554 | Send | busy | `sending === c.id` |
| src/components/client/SLAPolicyManager.tsx:211 | (icon) | reason + busy | `!form.name && 'fill_required_fields'` |
| src/components/client/TicketAssignments.tsx:396 | Assign | reason + busy | `!form.consultant_id && 'no_consultant_selected'` |
| src/components/client/TicketBids.tsx:118 | (icon) | busy | `shortlist.isPending` |
| src/components/client/TicketBids.tsx:122 | Cancel counter-offer | busy | `cancelCounter.isPending` |
| src/components/client/TicketBids.tsx:142 | Close bidding now | busy | `close.isPending` |
| src/components/client/TicketBids.tsx:143 | Accept bid | busy | `accept.isPending` |
| src/components/client/TicketBusinessProcesses.tsx:147 | Link | reason + busy | `!selectedId && 'choose_option_first'` |
| src/components/client/TicketCSAT.tsx:186 | Submit | reason + busy | `!rating && 'give_rating_first'` |
| src/components/client/TicketDocuments.tsx:106 | (icon) | busy | `uploadMutation.isPending` |
| src/components/client/TicketEditDialog.tsx:303 | Save Changes | busy | `saving` |
| src/components/client/TicketInternalNotes.tsx:100 | (icon) | reason + busy | `!newNote.trim() && 'type_message_first'` |
| src/components/client/TicketInterview.tsx:268 | (icon) | busy | `analyzing` |
| src/components/client/TicketInterview.tsx:449 | (icon) | busy | `requestMutation.isPending` |
| src/components/client/TicketLinks.tsx:220 | Link | reason + busy | `!selectedId && 'choose_option_first'` |
| src/components/client/TicketMatchRequests.tsx:219 | Withdraw | busy | `busyId === r.id` |
| src/components/client/TicketMatchRequests.tsx:263 | Wait longer ({{time}}, once) | busy | `busyId === r.id` |
| src/components/client/TicketMatchRequests.tsx:298 | Give more time | opt-out | `busy ` |
| src/components/client/TicketOutcomeControl.tsx:41 | (icon) | busy | `busy` |
| src/components/client/TicketOutcomeControl.tsx:54 | (icon) | busy | `busy` |
| src/components/client/TicketPlanApproval.tsx:185 | Approve Plan | busy | `saving` |
| src/components/client/TicketPlanApproval.tsx:189 | Reject | busy | `saving` |
| src/components/client/TicketPlanApproval.tsx:208 | Confirm Rejection | busy | `saving` |
| src/components/client/TicketTagsWatchers.tsx:151 | Add | busy | `adding` |
| src/components/client/TicketTimesheet.tsx:366 | (icon) | reason | `!!blockReason && { key: myWaiting ? 'already_done' : myOpenEntries.length === 0 ? 'no_work_logged' : myOpenEntries.some(e => (e.description ?? '').trim().length` |
| src/components/client/TicketTimesheet.tsx:493 | Cancel | busy | `deleting` |
| src/components/client/TicketTimesheet.tsx:494 | Delete the entry | busy | `deleting` |
| src/components/client/WriteReviewDialog.tsx:169 | (icon) | reason + busy | `score === 0 && 'give_rating_first'` |
| src/pages/client/BusinessProcessesPage.tsx:274 | (icon) | opt-out | `decorative leaf indicator; no children to expand ` |
| src/pages/client/BusinessProcessesPage.tsx:538 | (icon) | busy | `saving` |
| src/pages/client/BusinessProcessesPage.tsx:558 | (icon) | busy | `saving` |
| src/pages/client/BusinessProcessesPage.tsx:570 | (icon) | reason + busy | `!file && 'upload_file_first'` |
| src/pages/client/ChangeManagementPage.tsx:221 | Create | busy | `saving` |
| src/pages/client/CompanyProfilePage.tsx:442 | (icon) | opt-out | `busy ` |
| src/pages/client/CompanyProfilePage.tsx:465 | (icon) | busy | `uploadingLogo` |
| src/pages/client/CompanyProfilePage.tsx:816 | Save Company Profile | busy | `updateProfile.isPending` |
| src/pages/client/CompanySelectorPage.tsx:141 | (icon) | reason + busy | `!newCompanyName.trim() && 'fill_required_fields'` |
| src/pages/client/CompanySelectorPage.tsx:263 | (icon) | reason + busy | `!newCompanyName.trim() && 'fill_required_fields'` |
| src/pages/client/ConsultantsPage.tsx:454 | Open a request | reason | `!!c.holdUntil && { key: 'on_hold', message: holdDirectoryView(c.holdUntil, 'label', lang).label \|\| undefined, to: '/client/consultants' }` |
| src/pages/client/ContractsPage.tsx:384 | Cancel | busy | `revoking` |
| src/pages/client/ContractsPage.tsx:385 | (icon) | busy | `revoking` |
| src/pages/client/IntegrationsPage.tsx:137 | Coming soon | reason | `"feature_not_ready"` |
| src/pages/client/InvoicesPage.tsx:565 | Retry | busy | `retryingId === inv.id` |
| src/pages/client/InvoicesPage.tsx:655 | Retry | busy | `retryingId === selected.id` |
| src/pages/client/InvoicesPage.tsx:670 | Preview PDF | busy | `retryingId === selected.id` |
| src/pages/client/InvoicesPage.tsx:673 | (icon) | busy | `retryingId === selected.id` |
| src/pages/client/InvoicesPage.tsx:731 | (icon) | busy | `saving` |
| src/pages/client/InvoicesPage.tsx:849 | (icon) | busy | `creating` |
| src/pages/client/MajorIncidentsPage.tsx:306 | (icon) | busy | `saving` |
| src/pages/client/MilestonesPage.tsx:117 | (icon) | busy | `updateStatus.isPending` |
| src/pages/client/MyConsultantsPage.tsx:235 | fav.add_to_group | reason + busy | `[!bulkGroup && 'choose_option_first', !selectedIds.length && 'select_items_first']` |
| src/pages/client/MyConsultantsPage.tsx:239 | fav.remove_from_group | reason + busy | `[!bulkGroup && 'choose_option_first', !selectedIds.length && 'select_items_first']` |
| src/pages/client/MyConsultantsPage.tsx:244 | fav.tag | reason + busy | `[!bulkTag.trim() && 'fill_required_fields', !selectedIds.length && 'select_items_first']` |
| src/pages/client/MyConsultantsPage.tsx:248 | fav.remove | reason + busy | `!selectedIds.length && 'select_items_first'` |
| src/pages/client/MyConsultantsPage.tsx:253 | (icon) | reason | `shown.length === 0 && 'nothing_to_export'` |
| src/pages/client/MyConsultantsPage.tsx:366 | {t('fav.move_up', { name: g.name })} | reason + busy | `i === 0 && 'already_first'` |
| src/pages/client/MyConsultantsPage.tsx:368 | {t('fav.move_down', { name: g.name })} | reason + busy | `i === activeGroups.length - 1 && 'already_last'` |
| src/pages/client/MyConsultantsPage.tsx:373 | (icon) | busy | `busy` |
| src/pages/client/MyConsultantsPage.tsx:400 | fav.unblock | busy | `busy` |
| src/pages/client/NewRequestPage.tsx:1158 | ticket_create.ai_analyze | busy | `aiLoading === 'categorize'` |
| src/pages/client/NewRequestPage.tsx:1657 | onboarding.back | reason + busy | `step === 0 && 'already_first'` |
| src/pages/client/NewRequestPage.tsx:1665 | ticket_create.submit_request | busy | `submitting` |
| src/pages/client/NewRequestPage.tsx:1779 | (icon) | reason | `!picked && pickDisabled && { key: 'limit_reached', params: { max: MAX_INVITED_EXPERTS } }` |
| src/pages/client/ProblemManagementPage.tsx:177 | Create | busy | `saving` |
| src/pages/client/ProjectManagementTicketsPage.tsx:148 | (icon) | reason + busy | `!title.trim() && 'fill_required_fields'` |
| src/pages/client/ProjectsPage.tsx:898 | Assign | reason | `selectedTicketIds.length === 0 && 'select_items_first'` |
| src/pages/client/RemoteAccessPage.tsx:178 | (icon) | reason | `!name && 'fill_required_fields'` |
| src/pages/client/SessionDetailPage.tsx:334 | Mark as completed | busy | `isCompleting` |
| src/pages/client/SettingsPage.tsx:282 | Save Changes | busy | `saving` |
| src/pages/client/SolutionArchitecturePage.tsx:57 | New Document | reason | `"feature_not_ready"` |
| src/pages/client/TaskBoardPage.tsx:128 | Create Task | reason | `!title.trim() && 'fill_required_fields'` |
| src/pages/client/TeamMembersPage.tsx:121 | Invite | reason | `!isOwnerOrAdmin && 'company_admin_only'` |
| src/pages/client/TeamMembersPage.tsx:153 | Send Invitation | reason + busy | `!inviteEmail.trim() && 'invalid_email'` |
| src/pages/client/VMwareConsolePage.tsx:100 | (icon) | busy | `vmAction.isPending` |
| src/pages/client/VMwareConsolePage.tsx:160 | Create | reason + busy | `!snapshotName.trim() && 'fill_required_fields'` |
| src/pages/client/VMwarePricingPage.tsx:166 | Current plan | reason | `"same_as_current"` |
| src/pages/client/VMwarePricingPage.tsx:171 | Requested | reason | `"pending_admin_review"` |
| src/pages/client/VMwarePricingPage.tsx:177 | (icon) | busy | `busy` |
| src/pages/client/VMwareSettingsPage.tsx:111 | (icon) | reason + busy | `isActive && 'same_as_current'` |
| src/pages/client/VMwareSettingsPage.tsx:159 | Enable Pay as you go | busy | `subscribe.isPending` |

### Consultant (94)

| File | Label | Type | Condition |
|---|---|---|---|
| src/components/consultant/AddCertificateDialog.tsx:125 | Cancel | busy | `saving` |
| src/components/consultant/AddCertificateDialog.tsx:126 | Add certificate | busy | `saving` |
| src/components/consultant/AIInterviewFlow.tsx:1231 | Clarify Question | reason + busy | `messages.length === 0 && 'no_data_yet'` |
| src/components/consultant/AIInterviewFlow.tsx:1243 | Repeat | reason + busy | `messages.length === 0 && 'no_data_yet'` |
| src/components/consultant/AIInterviewFlow.tsx:1272 | (icon) | busy | `isStreaming` |
| src/components/consultant/AIInterviewFlow.tsx:1283 | (icon) | reason + busy | `!input.trim() && 'type_message_first'` |
| src/components/consultant/AIInterviewFlow.tsx:1360 | (icon) | busy | `isStreaming` |
| src/components/consultant/assignment/DeclineReasonDialog.tsx:80 | Decline | busy | `decline.isPending` |
| src/components/consultant/assignment/RequestInfoDialog.tsx:82 | (icon) | reason | `disabled && { key: 'limit_reached', params: { max: INFO_MAX_TOPICS } }` |
| src/components/consultant/assignment/RequestInfoDialog.tsx:123 | Cancel | busy | `ask.isPending` |
| src/components/consultant/assignment/RequestInfoDialog.tsx:124 | Send question | reason + busy | `tried && problems.length > 0 && { key: 'fix_errors_first', message: problems.map(problemText).join(' ') }` |
| src/components/consultant/AssignmentRequestDialog.tsx:133 | Open ticket description | busy | `busy` |
| src/components/consultant/AssignmentRequestDialog.tsx:138 | Decline | busy | `busy` |
| src/components/consultant/AssignmentRequestDialog.tsx:142 | Request more information | reason + busy | `askBlockedText ? { key: 'not_editable_now', message: askBlockedText } : undefined` |
| src/components/consultant/AssignmentRequestDialog.tsx:152 | View details | busy | `busy` |
| src/components/consultant/AssignmentRequestDialog.tsx:156 | Accept | reason + busy | `acceptReason ?? (acceptDisabled && 'previous_step_incomplete')` |
| src/components/consultant/AvailabilityToggle.tsx:162 | "Toggle availability" | opt-out | `busy ` |
| src/components/consultant/ConsultantLinksCard.tsx:202 | Save place and links | busy | `saving` |
| src/components/consultant/CounterOfferBanner.tsx:38 | Accept counter-offer | busy | `respond.isPending` |
| src/components/consultant/CounterOfferBanner.tsx:39 | Decline | busy | `respond.isPending` |
| src/components/consultant/CredlyBadgesSection.tsx:154 | Link | reason + busy | `!inputValue.trim() && 'fill_required_fields'` |
| src/components/consultant/CriticalAlarm.tsx:187 | Not for me | busy | `dismiss.isPending` |
| src/components/consultant/CriticalDashboardNotice.tsx:67 | Not for me | busy | `dismiss.isPending` |
| src/components/consultant/CvImportDialog.tsx:130 | Add to my profile | busy | `saving` |
| src/components/consultant/ExperienceCvCard.tsx:195 | (icon) | reason + busy | `!userId && 'sign_in_required'` |
| src/components/consultant/ExperienceCvCard.tsx:254 | Discard changes | busy | `jobState.saving` |
| src/components/consultant/HoldDialog.tsx:159 | (icon) | busy | `busy` |
| src/components/consultant/HoldDialog.tsx:160 | (icon) | busy | `busy` |
| src/components/consultant/HoldPanel.tsx:50 | (icon) | busy | `busy` |
| src/components/consultant/HoldPanel.tsx:62 | (icon) | busy | `busy` |
| src/components/consultant/InterviewPreflight.tsx:114 | Test camera and microphone | reason + busy | `!startable && 'offline'` |
| src/components/consultant/InterviewPreflight.tsx:121 | Continue text-only | reason | `!startable && 'offline'` |
| src/components/consultant/InterviewPreflight.tsx:124 | (icon) | reason | `!startable && 'offline'` |
| src/components/consultant/LocationDialog.tsx:48 | Save location | busy | `saving` |
| src/components/consultant/MatchRequestPopup.tsx:210 | Request more information | reason | `askBlockedText ? { key: 'not_editable_now', message: askBlockedText } : undefined` |
| src/components/consultant/MatchRequestPopup.tsx:213 | Accept | reason + busy | `[locationBlocked && 'location_missing', policyBlocked && 'policy_not_accepted', !slaReady && { key: 'sla_not_accepted', onNext: () => { const box = document.que` |
| src/components/consultant/MySuccessCard.tsx:78 | (icon) | busy | `busy` |
| src/components/consultant/NDASigningModal.tsx:346 | Proceed to Sign | reason | `ndaTextMissing && 'feature_not_ready'` |
| src/components/consultant/NDASigningModal.tsx:491 | (icon) | reason + busy | `[ndaTextMissing && 'feature_not_ready', !agreed && 'tick_confirmation_first', (sigType === 'type' ? typedName.trim().length < 2 : !hasDrawn) && 'signature_incom` |
| src/components/consultant/onboarding/ConsultantOnboarding.tsx:793 | onboarding.back | reason | `currentStep === 0 && 'first_page'` |
| src/components/consultant/onboarding/ConsultantOnboarding.tsx:803 | onboarding.next | reason | `!canNext() && 'previous_step_incomplete'` |
| src/components/consultant/onboarding/ConsultantOnboarding.tsx:808 | (icon) | busy | `submitting` |
| src/components/consultant/onboarding/steps/CityPicker.tsx:46 | (icon) | reason | `!country && 'choose_option_first'` |
| src/components/consultant/onboarding/steps/ImportStep.tsx:180 | (icon) | busy | `importing !== null` |
| src/components/consultant/OpenRequestPanel.tsx:59 | Send question | busy | `ask.isPending` |
| src/components/consultant/PayoutDetailsCard.tsx:237 | Save bank details | reason + busy | `[!valid && 'fix_errors_first', !ack && 'tick_confirmation_first', !bankDirty && 'nothing_changed']` |
| src/components/consultant/PayoutModal.tsx:145 | (icon) | reason + busy | `[(numAmount <= 0 \|\| numAmount > available) && 'invalid_value', !consultantId && 'profile_incomplete']` |
| src/components/consultant/policy/PolicyAcceptForm.tsx:38 | (icon) | reason + busy | `[...(Array.isArray(reason) ? reason : [reason]), disabled && !reason && 'not_editable_now', !checked && { key: 'policy_not_accepted', onNext: () => document.get` |
| src/components/consultant/PushAlertsCard.tsx:116 | Send me a test alert | busy | `test.isPending` |
| src/components/consultant/PushAlertsCard.tsx:119 | Turn off on this device | busy | `disable.isPending` |
| src/components/consultant/PushAlertsCard.tsx:138 | Enable phone alerts | busy | `busy` |
| src/components/consultant/RateClientCard.tsx:165 | Submit rating | busy | `saving` |
| src/components/consultant/ReinterviewDialog.tsx:160 | (icon) | busy | `loading` |
| src/components/consultant/RemoveCertificateButton.tsx:59 | Cancel | busy | `busy` |
| src/components/consultant/RemoveCertificateButton.tsx:60 | Remove | busy | `busy` |
| src/components/consultant/RemoveDuplicateSkills.tsx:53 | Cancel | busy | `busy` |
| src/components/consultant/RemoveDuplicateSkills.tsx:54 | Remove | busy | `busy` |
| src/components/consultant/RemoveSkillButton.tsx:50 | Cancel | busy | `busy` |
| src/components/consultant/RemoveSkillButton.tsx:51 | Remove | busy | `busy` |
| src/components/consultant/RescheduleSessionDialog.tsx:75 | Cancel | busy | `saving` |
| src/components/consultant/RescheduleSessionDialog.tsx:76 | Move the session | busy | `saving` |
| src/components/consultant/SapExpertiseCard.tsx:86 | Add | reason | `!custom.trim() && 'fill_required_fields'` |
| src/components/consultant/SapExpertiseCard.tsx:308 | Add module(s) | reason | `!picked.length && !customModule.trim() && 'select_items_first'` |
| src/components/consultant/saving/SectionSaveControls.tsx:13 | Save | reason + busy | `[...(Array.isArray(reason) ? reason : [reason]), disabled && !reason && 'loading_data', !state.dirty && 'nothing_changed']` |
| src/components/consultant/SetAvailabilityDialog.tsx:224 | (icon) | busy | `busy \|\| isLoading` |
| src/components/consultant/SetAvailabilityDialog.tsx:261 | Close | busy | `state.saving` |
| src/components/consultant/SubmitProposalModal.tsx:274 | (icon) | reason + busy | `[locationBlocked && 'location_missing', policyBlocked && 'policy_not_accepted', !slaReady && { key: 'sla_not_accepted', onNext: () => { const box = document.que` |
| src/components/consultant/TelegramAlertsCard.tsx:105 | Send a test message | busy | `test.isPending` |
| src/components/consultant/TelegramAlertsCard.tsx:108 | Disconnect | busy | `disconnect.isPending` |
| src/components/consultant/TelegramAlertsCard.tsx:128 | Disconnect | busy | `disconnect.isPending` |
| src/components/consultant/TelegramAlertsCard.tsx:143 | (icon) | busy | `connect.isPending` |
| src/components/consultant/TicketPlanSubmitForm.tsx:118 | Add line | reason | `lines.length >= 10 && { key: 'limit_reached', params: { max: 10 } }` |
| src/components/consultant/TicketPlanSubmitForm.tsx:147 | Submit plan | busy | `saving` |
| src/components/consultant/TicketPlanSubmitForm.tsx:151 | Cancel | busy | `saving` |
| src/components/consultant/TicketStatusActions.tsx:98 | (icon) | busy | `busy !== null` |
| src/components/consultant/TicketStatusActions.tsx:128 | Cancel | busy | `busy !== null` |
| src/components/consultant/TicketStatusActions.tsx:129 | Mark as resolved | busy | `busy !== null` |
| src/components/consultant/WeeklyAvailabilityEditor.tsx:201 | (icon) | reason + busy | `!dirty && 'nothing_changed'` |
| src/pages/consultant/BusinessProcessesPage.tsx:108 | (icon) | opt-out | `decorative leaf indicator, no child rows to expand ` |
| src/pages/consultant/CalendarPage.tsx:167 | Mark completed | busy | `busy !== null` |
| src/pages/consultant/CalendarPage.tsx:175 | It did not take place | busy | `busy !== null` |
| src/pages/consultant/InterviewsPage.tsx:149 | (icon) | reason + busy | `[isGuest && 'sign_in_required', !!block && block !== 'checking' && { key: block === 'signed_out' ? 'sign_in_required' : 'profile_incomplete', message: blockText` |
| src/pages/consultant/InterviewsPage.tsx:168 | Retry | busy | `isStarting` |
| src/pages/consultant/ReferAndEarnPage.tsx:124 | Save | reason + busy | `!!problem && { key: 'invalid_value', message: problem === 'blocked' ? t('refz.code_blocked', 'Please choose another code.') : t('refz.code_format', 'Use 4 to 24` |
| src/pages/consultant/ReferAndEarnPage.tsx:165 | (icon) | reason | `ov.disabled && 'feature_disabled_by_admin'` |
| src/pages/consultant/RequestsPage.tsx:339 | Request more information | reason | `askBlockedText ? { key: 'not_editable_now', message: askBlockedText } : undefined` |
| src/pages/consultant/RequestsPage.tsx:351 | Decline | busy | `respond.isPending` |
| src/pages/consultant/RequestsPage.tsx:360 | (icon) | reason + busy | `!slaOk(req.id) && { key: 'sla_not_accepted', onNext: () => { setPreviewId(null); window.setTimeout(() => { const box = document.getElementById('consultant-sla-$` |
| src/pages/consultant/RequestsPage.tsx:390 | Request more information | reason | `blocked ? { key: 'not_editable_now', message: blocked } : undefined` |
| src/pages/consultant/RequestsPage.tsx:393 | Accept | reason + busy | `!slaOk(req.id) && { key: 'sla_not_accepted', onNext: () => { setPreviewId(null); window.setTimeout(() => { const box = document.getElementById('consultant-sla-$` |
| src/pages/consultant/ResponsivenessPage.tsx:318 | Add period | reason | `[(!start \|\| !end) && 'choose_date_first', !consultantId && 'profile_incomplete']` |
| src/pages/consultant/ResponsivenessPage.tsx:362 | Send dispute | reason + busy | `reason.trim().length < 10 && { key: 'reason_required', params: { min: 10 } }` |
| src/pages/consultant/VerificationPage.tsx:376 | Add certificate | reason | `[!userId && 'sign_in_required', !consultantId && 'profile_incomplete']` |
| src/pages/consultant/WorkDiaryPage.tsx:97 | (icon) | busy | `createEntry.isPending` |

### Admin (202)

| File | Label | Type | Condition |
|---|---|---|---|
| src/components/admin/AssignmentRemindersCard.tsx:178 | Save timings | reason + busy | `[!dirty && 'nothing_changed', problems.length > 0 && 'fix_errors_first']` |
| src/components/admin/BankTransferSettingsCard.tsx:180 | (icon) | busy | `setCompany.isPending` |
| src/components/admin/BrdApprovalSettings.tsx:78 | brd.approval.admin.sendTest | busy | `sending` |
| src/components/admin/BrdSettingsCard.tsx:81 | brd.admin.save | busy | `busy` |
| src/components/admin/CertificateReview.tsx:86 | Open file | busy | `busy === 'open-${certificate.id}'` |
| src/components/admin/CertificateReview.tsx:93 | Remove verification | reason + busy | `readOnly && 'demo_read_only'` |
| src/components/admin/CertificateReview.tsx:97 | Verify | reason + busy | `readOnly && 'demo_read_only'` |
| src/components/admin/ClientTestimonialsManager.tsx:379 | Add testimonial | busy | `creating` |
| src/components/admin/ClientTestimonialsManager.tsx:646 | Save | busy | `savingId === item.id` |
| src/components/admin/console/sections/AvailabilityAdminSection.tsx:169 | Save | reason + busy | `!data?.ready && 'feature_not_ready'` |
| src/components/admin/console/sections/AvailabilityAdminSection.tsx:178 | Export CSV | reason | `!rows.length && 'nothing_to_export'` |
| src/components/admin/console/sections/AvailabilityAdminSection.tsx:179 | Send reminder now | reason + busy | `[!data?.ready && 'feature_not_ready', !selected.size && 'no_recipients']` |
| src/components/admin/console/sections/AvailabilityAdminSection.tsx:216 | Set hold | reason | `r.on_hold && 'same_as_current'` |
| src/components/admin/console/sections/AvailabilityAdminSection.tsx:266 | Clear hold | reason + busy | `clearReason.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }` |
| src/components/admin/console/sections/AvailabilityAdminSection.tsx:289 | Set hold | reason + busy | `[!holdEnd && 'choose_date_first', holdReason.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }]` |
| src/components/admin/console/sections/ConsultantPolicySection.tsx:166 | Save | reason + busy | `!ready && 'feature_not_ready'` |
| src/components/admin/console/sections/ConsultantPolicySection.tsx:182 | Export CSV | reason | `!shown.length && 'nothing_to_export'` |
| src/components/admin/console/sections/ConsultantPolicySection.tsx:211 | Send reminder | reason + busy | `!ready && 'feature_not_ready'` |
| src/components/admin/console/sections/ConsultantPolicySection.tsx:228 | Edit the text for a new version | reason | `(!ready \|\| !current.data?.ready) && 'feature_not_ready'` |
| src/components/admin/console/sections/ConsultantPolicySection.tsx:247 | Publish version {{v}} | busy | `publish.isPending` |
| src/components/admin/console/sections/InterviewWeightCard.tsx:51 | Save | reason + busy | `[!valid && 'invalid_value', n === saved && 'nothing_changed']` |
| src/components/admin/console/sections/InvoiceNumberingSection.tsx:198 | Review the change | busy | `setCounter.isPending` |
| src/components/admin/console/sections/InvoiceNumberingSection.tsx:249 | Cancel | busy | `setCounter.isPending` |
| src/components/admin/console/sections/InvoiceNumberingSection.tsx:250 | Change the counter | busy | `setCounter.isPending` |
| src/components/admin/console/sections/MissingLocationSection.tsx:117 | Save | reason + busy | `!ready && 'feature_not_ready'` |
| src/components/admin/console/sections/MissingLocationSection.tsx:128 | Export CSV | reason | `!rows.length && 'nothing_to_export'` |
| src/components/admin/console/sections/MissingLocationSection.tsx:129 | Send reminder now | reason + busy | `[!ready && 'feature_not_ready', !selected.size && 'no_recipients']` |
| src/components/admin/console/sections/ProfileFieldsSection.tsx:166 | Save changes | reason + busy | `!dirty && 'nothing_changed'` |
| src/components/admin/console/sections/SubscriptionsSection.tsx:137 | (icon) | busy | `saving` |
| src/components/admin/console/sections/SubscriptionsSection.tsx:213 | (icon) | busy | `saving` |
| src/components/admin/console/sections/VMwarePricingSection.tsx:236 | Cancel | busy | `save.isPending` |
| src/components/admin/console/sections/VMwarePricingSection.tsx:237 | Save plan | busy | `save.isPending` |
| src/components/admin/console/sections/VMwarePricingSection.tsx:300 | Reject | busy | `pendingId === s.id` |
| src/components/admin/console/sections/VMwarePricingSection.tsx:308 | Activate | busy | `pendingId === s.id` |
| src/components/admin/ConsultantFullProfileSheet.tsx:104 | (icon) | reason | `!pay.iban && !pay.account_number && !pay.swift_bic && 'no_data_yet'` |
| src/components/admin/ConsultantTrustPanel.tsx:55 | Remove check | reason + busy | `readOnly && 'demo_read_only'` |
| src/components/admin/ConsultantTrustPanel.tsx:59 | (icon) | reason + busy | `readOnly && 'demo_read_only'` |
| src/components/admin/CriticalServiceSettingsCard.tsx:91 | (icon) | reason + busy | `[!!problem && 'fix_errors_first', !changed && 'nothing_changed']` |
| src/components/admin/FoundingOverride.tsx:25 | (icon) | reason + busy | `!reason.trim() && { key: 'field_required', params: { field: t('founding.reason', 'Reason (recorded in audit log)') }, onNext: () => document.getElementById('fou` |
| src/components/admin/FoundingSettings.tsx:31 | Save | reason + busy | `[!q.data && 'feature_not_ready', (!Number.isInteger(Number(limit)) \|\| Number(limit)<1 \|\| Number(limit)>100000 \|\| !Number.isInteger(Number(boost)) \|\| Num` |
| src/components/admin/interview-knowledge/KnowledgeDocumentsPanel.tsx:144 | Upload document | reason | `!ready && 'feature_not_ready'` |
| src/components/admin/interview-knowledge/KnowledgeDocumentsPanel.tsx:178 | Preview excerpts | reason | `!d.chunk_count && 'no_data_yet'` |
| src/components/admin/interview-knowledge/KnowledgeDocumentsPanel.tsx:179 | Re-extract | busy | `working === d.id` |
| src/components/admin/interview-knowledge/KnowledgeDocumentsPanel.tsx:180 | {t('ik.docs.delete', 'Delete')} | busy | `working === d.id` |
| src/components/admin/interview-knowledge/KnowledgeDocumentsPanel.tsx:226 | Cancel | busy | `busy` |
| src/components/admin/interview-knowledge/KnowledgeDocumentsPanel.tsx:227 | (icon) | reason + busy | `[!form.rights && 'tick_confirmation_first', (!form.title.trim() \|\| !form.sap_module.trim()) && 'fill_required_fields']` |
| src/components/admin/interview-knowledge/KnowledgeDocumentsPanel.tsx:259 | Delete | reason | `deleteReason.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }` |
| src/components/admin/interview-knowledge/KnowledgePreviewPanel.tsx:95 | Build preview | reason + busy | `[!picked && 'choose_option_first', !ready && 'feature_not_ready']` |
| src/components/admin/interview-knowledge/KnowledgeSettingsPanel.tsx:86 | Save | busy | `save.isPending \|\| settings.isLoading` |
| src/components/admin/interview-knowledge/KnowledgeSettingsPanel.tsx:102 | Edit this list | reason | `!ready && 'feature_not_ready'` |
| src/components/admin/interview-knowledge/QuestionQualityPanel.tsx:94 | (icon) | busy | `busy` |
| src/components/admin/interview-knowledge/QuestionQualityPanel.tsx:101 | Retire | busy | `busy` |
| src/components/admin/interview-knowledge/QuestionQualityPanel.tsx:102 | Use again | busy | `busy` |
| src/components/admin/interview-knowledge/VoiceLearningPanel.tsx:234 | (icon) | busy | `busy` |
| src/components/admin/interview-knowledge/VoiceLearningPanel.tsx:239 | Approve | busy | `busy` |
| src/components/admin/interview-knowledge/VoiceLearningPanel.tsx:241 | Reject | busy | `busy` |
| src/components/admin/interview-knowledge/VoiceLearningPanel.tsx:263 | Activate anyway | busy | `busy` |
| src/components/admin/interview-knowledge/VoiceLearningPanel.tsx:286 | Restore | busy | `busy` |
| src/components/admin/interview-knowledge/VoiceLearningPanel.tsx:303 | {t('voice.learnadmin.remove', 'Remove {{term}}', { term: term.term })} | opt-out | `busy ` |
| src/components/admin/interview-knowledge/VoiceLearningPanel.tsx:364 | Restore | busy | `busy` |
| src/components/admin/interview-knowledge/VoiceMetricsPanel.tsx:179 | Save voice settings | reason + busy | `!ready && 'feature_not_ready'` |
| src/components/admin/InviteUserDialog.tsx:90 | Send email invitation | busy | `sending` |
| src/components/admin/InvoiceBankControls.tsx:153 | Use the platform account again | busy | `setAccount.isPending` |
| src/components/admin/InvoiceBankControls.tsx:162 | Save the account of this invoice | reason + busy | `!canSave && 'fill_required_fields'` |
| src/components/admin/InvoiceSellerCard.tsx:111 | Save seller details | reason + busy | `!dirty && 'nothing_changed'` |
| src/components/admin/LogoCropDialog.tsx:150 | Cancel | busy | `busy` |
| src/components/admin/LogoCropDialog.tsx:153 | (icon) | reason + busy | `[(!pixels \|\| sizeBytes === null) && 'crop_not_ready', overLimit && 'crop_too_large']` |
| src/components/admin/MatchWeightsCard.tsx:78 | (icon) | reason + busy | `!valid && 'invalid_value'` |
| src/components/admin/MatchWeightsCard.tsx:79 | (icon) | busy | `busy \|\| q.isPending` |
| src/components/admin/messages/CampaignsPanel.tsx:153 | Numbers as CSV | reason | `!contacts.data?.length && 'nothing_to_export'` |
| src/components/admin/messages/ComposeMessage.tsx:307 | Preview recipients | busy | `previewing` |
| src/components/admin/messages/ComposeMessage.tsx:442 | (icon) | reason + busy | `[!preview && { key: 'preview_first', onNext: () => void runPreview(), nextLabel: t('bmsg.preview_recipients', 'Preview recipients') }, count <= 0 && 'no_recipie` |
| src/components/admin/messages/MessagingSettingsPanel.tsx:39 | Save | busy | `setSettings.isPending` |
| src/components/admin/nda/NDARevokeDialog.tsx:32 | (icon) | opt-out | `busy ` |
| src/components/admin/nda/NdaSignaturesPanel.tsx:87 | (icon) | reason | `sig.anonymised && 'signature_anonymised'` |
| src/components/admin/nda/NdaSignaturesPanel.tsx:159 | ndaSign.admin.save | reason + busy | `[!dirty && 'nothing_changed', !valid && 'fix_errors_first']` |
| src/components/admin/nda/NdaSignaturesPanel.tsx:203 | ndaSign.admin.showFull | reason + busy | `reason.trim().length < 10 && { key: 'reason_required', params: { min: 10 } }` |
| src/components/admin/NDATemplateEditor.tsx:167 | (icon) | reason + busy | `[!isDirty && 'nothing_changed', previewing && { key: 'not_editable_now', onNext: () => { setPreviewing(false); setShowSampleEditor(false); }, nextLabel: t('admi` |
| src/components/admin/PendingVerificationItems.tsx:159 | Cancel | busy | `saving` |
| src/components/admin/PendingVerificationItems.tsx:160 | (icon) | busy | `saving` |
| src/components/admin/PricingSettingsCard.tsx:71 | Save pricing | reason + busy | `[!valid && 'invalid_value', unchanged && 'nothing_changed']` |
| src/components/admin/PushAdminCard.tsx:51 | Create the keys for phone alerts | busy | `generate.isPending` |
| src/components/admin/PushAdminCard.tsx:55 | Refresh | busy | `statusQ.isFetching` |
| src/components/admin/referral/EmailSenderCard.tsx:91 | Save sender settings | reason + busy | `[!canEdit && (!installed ? 'feature_not_ready' : { key: 'permission_missing', params: { role: t('esend.super_admin_required', 'Only super administrators can edi` |
| src/components/admin/referral/ReferralDashboard.tsx:96 | Refresh | busy | `q.isFetching` |
| src/components/admin/referral/ReferralEmailPreview.tsx:117 | Send test to me | busy | `busy` |
| src/components/admin/referral/ReferralInviteSettingsCard.tsx:86 | Save settings | busy | `busy` |
| src/components/admin/ScheduleLiveInterviewDialog.tsx:244 | Cancel | busy | `saving` |
| src/components/admin/ScheduleLiveInterviewDialog.tsx:245 | Schedule | reason + busy | `noInterviewerAvailable && 'no_interviewer_available'` |
| src/components/admin/SendMatchDialog.tsx:332 | Send to Consultant | reason + busy | `selected.size === 0 && 'select_items_first'` |
| src/components/admin/SendViaSelector.tsx:43 | (icon) | opt-out | `each unavailable channel lists its reason right below; whole picker follows the parent's disabled ` |
| src/components/admin/SuccessAdmin.tsx:96 | (icon) | busy | `busy === e.ticket_id` |
| src/components/admin/SuccessAdmin.tsx:97 | (icon) | busy | `busy === e.ticket_id` |
| src/components/admin/SuccessAdmin.tsx:164 | (icon) | busy | `recomputing` |
| src/components/admin/SuccessAdmin.tsx:189 | (icon) | reason + busy | `problems.length > 0 && 'fix_errors_first'` |
| src/components/admin/SuccessAdmin.tsx:211 | (icon) | busy | `busy === d.id` |
| src/components/admin/SuccessAdmin.tsx:212 | (icon) | busy | `busy === d.id` |
| src/components/admin/SuccessAdmin.tsx:213 | (icon) | busy | `busy === d.id` |
| src/components/admin/TelegramAdminCard.tsx:87 | Connect the bot to the portal | busy | `setWebhook.isPending` |
| src/components/admin/TelegramAdminCard.tsx:92 | Connect again | busy | `setWebhook.isPending` |
| src/components/admin/TelegramAdminCard.tsx:96 | Refresh | busy | `statusQ.isFetching` |
| src/components/admin/users/AccessPanels.tsx:318 | Previous | reason | `page <= 1 && 'first_page'` |
| src/components/admin/users/AccessPanels.tsx:320 | Next | reason | `page >= pages && 'last_page'` |
| src/components/admin/users/BulkBar.tsx:89 | Tag | reason | `over && { key: 'too_many_recipients', params: { max: BULK_LIMIT } }` |
| src/components/admin/users/BulkBar.tsx:90 | Untag | reason | `over && { key: 'too_many_recipients', params: { max: BULK_LIMIT } }` |
| src/components/admin/users/BulkBar.tsx:91 | Remind | reason | `over && { key: 'too_many_recipients', params: { max: BULK_LIMIT } }` |
| src/components/admin/users/BulkBar.tsx:92 | Suspend | reason | `over && { key: 'too_many_recipients', params: { max: BULK_LIMIT } }` |
| src/components/admin/users/BulkBar.tsx:93 | Reactivate | reason | `over && { key: 'too_many_recipients', params: { max: BULK_LIMIT } }` |
| src/components/admin/users/BulkBar.tsx:119 | Preview | reason + busy | `((kind === 'tag_add' \|\| kind === 'tag_remove') && !tags.trim()) && 'fill_required_fields'` |
| src/components/admin/users/BulkInviteDialog.tsx:90 | Send {{n}} invitations | reason + busy | `!ready.length && 'no_recipients'` |
| src/components/admin/users/BulkInviteDialog.tsx:91 | Preview | reason + busy | `!parsed.rows.length && 'no_recipients'` |
| src/components/admin/users/ReferralInviteDialog.tsx:197 | Download report (CSV) | reason | `!report.data?.rows?.length && 'nothing_to_export'` |
| src/components/admin/users/ReferralInviteDialog.tsx:261 | Send to me only | reason + busy | `[!installed && 'feature_not_ready', selected.length === 0 && 'choose_option_first']` |
| src/components/admin/users/ReferralInviteDialog.tsx:262 | Send to {{n}} | reason + busy | `blocker && blocker !== 'busy' && { key: blocker === 'not_installed' ? 'feature_not_ready' : blocker === 'switched_off' ? 'feature_disabled_by_admin' : blocker =` |
| src/components/admin/users/UserDetailSheet.tsx:133 | Resend confirmation e-mail | reason + busy | `!idReady && 'auth_user_id_missing'` |
| src/components/admin/users/UserDetailSheet.tsx:134 | Mark e-mail as confirmed | reason + busy | `!idReady && 'auth_user_id_missing'` |
| src/components/admin/users/UserDetailSheet.tsx:199 | Add | reason + busy | `!/^[a-z0-9][a-z0-9 _-]{0,29}$/i.test(tagInput.trim()) && 'invalid_value'` |
| src/components/admin/users/UserDetailSheet.tsx:254 | Add note | reason + busy | `!note.trim() && 'fill_required_fields'` |
| src/components/admin/users/UserDialogs.tsx:45 | (icon) | reason + busy | `!canConfirm && (blockedReason \|\| 'fill_required_fields')` |
| src/components/admin/users/UserDialogs.tsx:78 | Save | reason + busy | `[!name.trim() && 'fill_required_fields', phoneBad && { key: 'invalid_value', message: t('um.phone_invalid', 'Use digits, spaces, +, ( ) and - only.') }]` |
| src/components/admin/users/UserDialogs.tsx:129 | Save | reason + busy | `!check.ok && { key: check.error === 'no_change' ? 'nothing_changed' : check.error === 'self' ? 'is_yourself' : check.error === 'reason' ? 'reason_required' : 'n` |
| src/components/admin/users/UserDialogs.tsx:158 | Send | reason + busy | `[(!title.trim() \|\| !body.trim()) && 'type_message_first', linkBad && 'invalid_value']` |
| src/components/admin/users/UserDialogs.tsx:232 | Merge | reason + busy | `[!keep && 'choose_option_first', !preview && 'preview_first', !ack && 'tick_confirmation_first', !reasonOk(reason) && { key: 'reason_required', params: { min: M` |
| src/components/admin/users/UsersToolbar.tsx:154 | Save | reason | `!viewName.trim() && 'fill_required_fields'` |
| src/pages/admin/AdminAgreementsPage.tsx:109 | agreements.admin.reject | reason | `note.trim().length < 5 && { key: 'reason_required', params: { min: 5 } }` |
| src/pages/admin/AdminAgreementsPage.tsx:165 | agreements.save | reason + busy | `reason.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }` |
| src/pages/admin/AdminErrorsPage.tsx:123 | Refresh | busy | `isFetching` |
| src/pages/admin/AdminErrorsPage.tsx:275 | Delete | busy | `deleteMutation.isPending` |
| src/pages/admin/AdminErrorsPage.tsx:288 | Mark Resolved | busy | `resolveMutation.isPending` |
| src/pages/admin/AdminSlaPage.tsx:131 | sla.admin.save | busy | `busy` |
| src/pages/admin/AdminSlaPage.tsx:177 | sla.admin.save | busy | `busy` |
| src/pages/admin/AdminSlaPage.tsx:187 | sla.admin.testSend | busy | `busy` |
| src/pages/admin/AdminSlaPage.tsx:222 | sla.editor.add | reason | `[!hList && 'choose_option_first', !hDay && 'choose_date_first']` |
| src/pages/admin/AdminSlaPage.tsx:239 | sla.admin.export | reason | `!report.data?.breaches?.length && 'nothing_to_export'` |
| src/pages/admin/AdminSlaPage.tsx:271 | sla.admin.simRun | reason | `!/^[0-9a-f-]{36}$/i.test(simTicket) && 'invalid_value'` |
| src/pages/admin/ClientApprovalsPage.tsx:327 | Reject | reason + busy | `[!hasComment && 'type_message_first', row.status === 'rejected' && 'same_as_current', row.status === 'draft' && 'client_information_not_submitted']` |
| src/pages/admin/ClientApprovalsPage.tsx:335 | Send comments | reason + busy | `[!hasComment && 'type_message_first', row.status === 'draft' && 'client_information_not_submitted']` |
| src/pages/admin/ClientApprovalsPage.tsx:342 | Approve | reason + busy | `row.status === 'approved' && 'same_as_current'` |
| src/pages/admin/ClientApprovalsPage.tsx:421 | Refresh | busy | `isFetching` |
| src/pages/admin/ConsultantApprovalsPage.tsx:438 | (icon) | busy | `updateStatus.isPending` |
| src/pages/admin/ConsultantApprovalsPage.tsx:481 | Cancel | busy | `updateStatus.isPending` |
| src/pages/admin/ConsultantApprovalsPage.tsx:484 | (icon) | busy | `updateStatus.isPending` |
| src/pages/admin/DemoRequestsPage.tsx:156 | Confirm this time | reason + busy | `past && 'date_in_past'` |
| src/pages/admin/DemoRequestsPage.tsx:189 | Close | busy | `saving` |
| src/pages/admin/DemoRequestsPage.tsx:190 | Save | reason + busy | `(status === row.status && (note.trim() \|\| null) === (row.status_note ?? null)) && 'nothing_changed'` |
| src/pages/admin/EnvironmentsPage.tsx:379 | (icon) | reason | `[!name && { key: 'field_required', params: { field: t('common.name', 'Name') } }, !clientId && 'choose_option_first', !guacamoleUrl && { key: 'field_required', ` |
| src/pages/admin/FeedbackAdminPage.tsx:221 | Set | reason + busy | `(dup !== '' && !UUID.test(dup)) && 'invalid_value'` |
| src/pages/admin/FeedbackAdminPage.tsx:229 | Save notes | reason + busy | `notes === (row.admin_notes ?? '') && 'nothing_changed'` |
| src/pages/admin/FeedbackAdminPage.tsx:241 | Send reply | reason + busy | `[reply.trim().length < 2 && { key: 'text_too_short', params: { min: 2 } }, (!row.user_id && !(emailReply && row.consent_contact)) && 'reply_recipient_unavailabl` |
| src/pages/admin/FeedbackAdminPage.tsx:396 | CSV | busy | `exporting` |
| src/pages/admin/FeedbackAdminPage.tsx:408 | Apply | reason | `!bulkStatus && 'choose_option_first'` |
| src/pages/admin/FeedbackAdminPage.tsx:466 | Previous | reason | `filters.page === 0 && 'first_page'` |
| src/pages/admin/FeedbackAdminPage.tsx:468 | Next | reason | `filters.page + 1 >= pages && 'last_page'` |
| src/pages/admin/InterviewTemplatesPage.tsx:244 | Save | busy | `saving` |
| src/pages/admin/InterviewTrainingPage.tsx:333 | (icon) | busy | `extracting` |
| src/pages/admin/InterviewTrainingPage.tsx:355 | (icon) | busy | `generating` |
| src/pages/admin/InterviewTrainingPage.tsx:424 | (icon) | busy | `saveMutation.isPending` |
| src/pages/admin/KnowledgeReviewPage.tsx:130 | Save changes | reason + busy | `!!problemText && { key: 'fix_errors_first', message: problemText }` |
| src/pages/admin/KnowledgeReviewPage.tsx:132 | Publish | reason + busy | `[!!problemText && { key: 'fix_errors_first', message: problemText }, !confirmed && 'tick_confirmation_first']` |
| src/pages/admin/KnowledgeReviewPage.tsx:208 | Learn from finished tickets | reason + busy | `switches.data?.ai_learning_enabled === false && { key: 'ai_learning_disabled', onNext: () => document.getElementById('ai-learning-switch')?.focus() }` |
| src/pages/admin/KnowledgeReviewPage.tsx:269 | Archive | busy | `update.isPending` |
| src/pages/admin/KnowledgeReviewPage.tsx:279 | Unpublish | busy | `update.isPending` |
| src/pages/admin/KnowledgeReviewPage.tsx:285 | Back to drafts | busy | `update.isPending` |
| src/pages/admin/LandingEditorPage.tsx:261 | Save | busy | `saving === sec.key` |
| src/pages/admin/MeetingJoinEventsExportPage.tsx:166 | mje_export.download | busy | `isLoading` |
| src/pages/admin/MeetingJoinEventsExportPage.tsx:247 | mje_export.refresh | busy | `isFetching` |
| src/pages/admin/NDAManagementPage.tsx:135 | (icon) | reason | `ndas.length === 0 && 'nothing_to_export'` |
| src/pages/admin/OnCallSchedulePage.tsx:263 | Save shift | busy | `saving` |
| src/pages/admin/OnCallSchedulePage.tsx:309 | Create | busy | `saving` |
| src/pages/admin/PaymentsAdminPage.tsx:405 | Start | reason + busy | `!p.has_details && { key: 'missing_payout_details', to: undefined }` |
| src/pages/admin/PaymentsAdminPage.tsx:409 | Mark paid | reason | `!p.has_details && { key: 'missing_payout_details', to: undefined }` |
| src/pages/admin/PaymentsAdminPage.tsx:414 | Retry | busy | `setPayout.isPending` |
| src/pages/admin/PaymentsAdminPage.tsx:492 | Confirm payment | reason + busy | `!bankRef.trim() && 'payment_reference_missing'` |
| src/pages/admin/PaymentsAdminPage.tsx:521 | Send to the client | reason + busy | `!note.trim() && { key: 'reason_required', params: { min: 1 } }` |
| src/pages/admin/PaymentsAdminPage.tsx:553 | (icon) | reason + busy | `!text.trim() && (paid ? 'payment_reference_missing' : { key: 'reason_required', params: { min: 1 } })` |
| src/pages/admin/PaymentsAdminPage.tsx:609 | Mark as verified | busy | `verify.isPending` |
| src/pages/admin/PaymentsAdminPage.tsx:702 | Create invoice | reason + busy | `[clientId === 'none' && 'choose_option_first', !(Number(amount) > 0) && 'invalid_value', description.trim().length < 3 && { key: 'text_too_short', params: { min` |
| src/pages/admin/PaymentsAdminPage.tsx:763 | Save | reason + busy | `commission === '' && { key: 'field_required', params: { field: 'Commission percentage' } }` |
| src/pages/admin/PaymentsAdminPage.tsx:770 | Save | reason + busy | `vat === '' && { key: 'field_required', params: { field: 'VAT percentage' } }` |
| src/pages/admin/PaymentsAdminPage.tsx:796 | Save bank details | busy | `save.isPending` |
| src/pages/admin/PaymentsAdminPage.tsx:969 | Switch on | busy | `save.isPending` |
| src/pages/admin/QuestionLibraryPage.tsx:280 | Save | busy | `saving` |
| src/pages/admin/QuestionLibraryPage.tsx:301 | (icon) | busy | `genLoading` |
| src/pages/admin/ReferralsAdminPage.tsx:79 | Send test to me | busy | `busy` |
| src/pages/admin/ReferralsAdminPage.tsx:80 | Send announcement ( ) | reason + busy | `[!tested && { key: 'announcement_test_required', onNext: () => void send(true) }, !counts.eligible && 'no_eligible_recipients']` |
| src/pages/admin/ReferralsAdminPage.tsx:120 | Set referrer | reason + busy | `[reason.trim().length < 5 && { key: 'reason_required', params: { min: 5 } }, !referredCode && { key: 'field_required', params: { field: 'Referred code' } }, !re` |
| src/pages/admin/ReferralsAdminPage.tsx:236 | Approve | reason + busy | `(note[id] ?? '').trim().length < 5 && { key: 'reason_required', params: { min: 5 } }` |
| src/pages/admin/ReferralsAdminPage.tsx:237 | Reject | reason + busy | `(note[id] ?? '').trim().length < 5 && { key: 'reason_required', params: { min: 5 } }` |
| src/pages/admin/ReferralsAdminPage.tsx:410 | Confirm | reason + busy | `[reason.trim().length < 5 && { key: 'reason_required', params: { min: 5 } }, !amountOk && 'invalid_value', state.needsReferrer && !newCode.trim() && { key: 'fie` |
| src/pages/admin/ReferralsAdminPage.tsx:542 | Remove | reason | `tiers.length <= 1 && { key: 'minimum_items', params: { min: 1 } }` |
| src/pages/admin/ReferralsAdminPage.tsx:545 | Add tier | reason | `tiers.length >= MAX_TIERS && { key: 'limit_reached', params: { max: MAX_TIERS } }` |
| src/pages/admin/ReferralsAdminPage.tsx:553 | Save settings | reason + busy | `reason.trim().length < 5 && { key: 'reason_required', params: { min: 5 } }` |
| src/pages/admin/ResponsivenessAdminPage.tsx:94 | Save | reason + busy | `problems.length > 0 && 'fix_errors_first'` |
| src/pages/admin/ResponsivenessAdminPage.tsx:136 | Void the no-response | busy | `busy === d.id` |
| src/pages/admin/ResponsivenessAdminPage.tsx:137 | Reject dispute | busy | `busy === d.id` |
| src/pages/admin/ResponsivenessAdminPage.tsx:208 | Recalculate now | busy | `recomputing` |
| src/pages/admin/ResponsivenessAdminPage.tsx:233 | CSV | reason | `!rows.length && 'nothing_to_export'` |
| src/pages/admin/UsersPage.tsx:139 | Refresh | busy | `search.isFetching` |
| src/pages/admin/UsersPage.tsx:140 | Export CSV | reason | `!total && 'nothing_to_export'` |
| src/pages/admin/UsersPage.tsx:159 | (icon) | opt-out | `summary-only statistic has no filter action ` |
| src/pages/admin/UsersPage.tsx:191 | Previous | reason | `filters.page <= 1 && 'first_page'` |
| src/pages/admin/UsersPage.tsx:193 | Next | reason | `filters.page >= pages && 'last_page'` |

### Agreements (30)

| File | Label | Type | Condition |
|---|---|---|---|
| src/components/agreements/AgreementCrew.tsx:139 | agreements.crew.addCta | reason | `[!pick && 'no_consultant_selected', value.length >= settings.crew_max - 1 && 'team_full']` |
| src/components/agreements/AgreementCrew.tsx:256 | agreements.crew.acceptCta | reason + busy | `[!slaOk && 'sla_not_accepted', typed.trim().length < 2 && { key: 'text_too_short', params: { min: 2 } }]` |
| src/components/agreements/AgreementCrew.tsx:258 | agreements.decline | busy | `busy` |
| src/components/agreements/AgreementCrew.tsx:265 | agreements.crew.addCta | reason | `[!free.length && 'no_data_yet', members.length >= settings.crew_max && 'team_full']` |
| src/components/agreements/AgreementCrew.tsx:304 | (icon) | reason + busy | `!edit?.entry.consultant_id && 'no_consultant_selected'` |
| src/components/agreements/AgreementCrew.tsx:318 | agreements.confirm | reason + busy | `reason.trim().length < 5 && { key: 'reason_required', params: { min: 5 } }` |
| src/components/agreements/AgreementDocuments.tsx:132 | agreements.docs.download | busy | `!!busy` |
| src/components/agreements/AgreementDocuments.tsx:134 | {t('agreements.docs.archive')} | busy | `!!busy` |
| src/components/agreements/AgreementDocuments.tsx:142 | agreements.docs.download | busy | `!!busy` |
| src/components/agreements/AgreementDocuments.tsx:183 | agreements.docs.uploadCta | reason + busy | `[!file && 'upload_file_first', !!fileProblem && { key: 'fix_errors_first', message: t('agreements.err.${fileProblem}', { mb: settings.doc_max_mb }) }, !!textPro` |
| src/components/agreements/AgreementDocuments.tsx:195 | (icon) | reason + busy | `reason` |
| src/components/agreements/AgreementRequestForm.tsx:77 | agreements.form.add | reason | `[!v.includes('@') && 'invalid_email', value.length >= max && { key: 'limit_reached', params: { max } }]` |
| src/components/agreements/AgreementRequestForm.tsx:201 | agreements.form.saveDraft | busy | `busy` |
| src/components/agreements/AgreementRequestForm.tsx:377 | agreements.form.addContact | reason | `esc.length >= settings.contacts_max && { key: 'limit_reached', params: { max: settings.contacts_max } }` |
| src/components/agreements/AgreementRequestForm.tsx:395 | agreements.form.saveDraft | busy | `busy` |
| src/components/agreements/AgreementRequestForm.tsx:397 | agreements.form.publish | reason + busy | `!check.canPublish && 'fix_errors_first'` |
| src/components/agreements/AgreementRequestForm.tsx:426 | agreements.form.publishNow | reason + busy | `inviteOnly && !invite.length && 'no_recipients'` |
| src/components/agreements/AgreementWorkspace.tsx:108 | agreements.apply.withdraw | busy | `!!busy` |
| src/components/agreements/AgreementWorkspace.tsx:138 | agreements.save | reason + busy | `!handover.trim() && 'type_message_first'` |
| src/components/agreements/AgreementWorkspace.tsx:160 | agreements.detail.pdf | busy | `pdfBusy` |
| src/components/agreements/AgreementWorkspace.tsx:213 | agreements.detail.select | busy | `!!busy` |
| src/components/agreements/AgreementWorkspace.tsx:231 | agreements.accept | busy | `!!busy` |
| src/components/agreements/AgreementWorkspace.tsx:232 | agreements.decline | busy | `!!busy` |
| src/components/agreements/AgreementWorkspace.tsx:246 | agreements.neg.send | reason + busy | `!Object.keys(offerPatch(terms, counter)).length && 'nothing_changed'` |
| src/components/agreements/AgreementWorkspace.tsx:261 | agreements.acc.cta | reason + busy | `[!accept && 'tick_confirmation_first', typedName.trim().length < 3 && { key: 'text_too_short', params: { min: 3 } }]` |
| src/components/agreements/AgreementWorkspace.tsx:287 | agreements.accept | busy | `!!busy` |
| src/components/agreements/AgreementWorkspace.tsx:288 | agreements.decline | busy | `!!busy` |
| src/components/agreements/AgreementWorkspace.tsx:342 | agreements.confirm | reason + busy | `[text.trim().length < (dialog === 'rate' ? 0 : 5) && { key: 'reason_required', params: { min: 5 } }, ((dialog === 'rate' \|\| dialog === 'suspend') && !dateVal)` |
| src/components/agreements/AgreementWorkspace.tsx:458 | agreements.msg.send | reason + busy | `[!msg.trim() && 'type_message_first', (!!setTo && a.status === 'open' && !to) && 'no_recipients']` |
| src/components/agreements/ApplyDialog.tsx:91 | (icon) | reason + busy | `[!slaOk && 'sla_not_accepted', rateBad && 'invalid_value', !/^[A-Z]{3}$/.test(currency) && 'invalid_value']` |

### Workflow (84)

| File | Label | Type | Condition |
|---|---|---|---|
| src/components/brd/approval/BrdApprovalPanel.tsx:147 | brd.approval.record | busy | `exporting` |
| src/components/brd/approval/BrdApprovalPanel.tsx:288 | Cancel | busy | `busy` |
| src/components/brd/approval/BrdApprovalPanel.tsx:289 | brd.approval.askConfirm | busy | `busy` |
| src/components/brd/approval/BrdApprovalPanel.tsx:313 | Cancel | busy | `busy` |
| src/components/brd/approval/BrdApprovalPanel.tsx:314 | (icon) | reason + busy | `!ok && { key: 'reason_required', params: { min } }` |
| src/components/brd/approval/BrdDecisionDialog.tsx:77 | Cancel | busy | `busy` |
| src/components/brd/approval/BrdDecisionDialog.tsx:78 | (icon) | busy | `busy` |
| src/components/brd/BrdAttachDialog.tsx:104 | Cancel | busy | `busy` |
| src/components/brd/BrdAttachDialog.tsx:105 | brd.attach.confirm | reason + busy | `!version && 'brd_not_submitted'` |
| src/components/brd/BrdComments.tsx:78 | brd.comments.send | reason + busy | `[!text.trim() && 'type_message_first', blocked && { key: 'fix_errors_first', message: t('brd.comments.noContacts') }, (mode === 'suggestion' && !suggest.trim())` |
| src/components/brd/BrdQuestions.tsx:35 | (icon) | reason | `readOnly && 'not_editable_now'` |
| src/components/brd/BrdQuestions.tsx:46 | brd.questions.update | reason + busy | `answered === 0 && 'answer_required'` |
| src/components/brd/BrdVersionsPanel.tsx:64 | brd.versions.compare | reason + busy | `picked.length !== 2 && 'choose_two_versions'` |
| src/components/brd/BrdVersionsPanel.tsx:94 | brd.versions.restore | busy | `busy` |
| src/components/brd/BrdVersionsPanel.tsx:138 | brd.versions.archive | reason | `reason.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }` |
| src/components/brd/BrdWorkspace.tsx:248 | brd.versions.saveNew | reason | `problems.length > 0 && 'fix_errors_first'` |
| src/components/brd/BrdWorkspace.tsx:254 | brd.export.label | busy | `exporting` |
| src/components/brd/BrdWorkspace.tsx:263 | brd.attach.button | reason | `versions.length === 0 && 'brd_not_submitted'` |
| src/components/brd/BrdWorkspace.tsx:480 | brd.comments.addToDraft | reason | `readOnly && 'not_editable_now'` |
| src/components/brd/RequirementsTable.tsx:85 | brd.req.add | reason | `rows.length >= LIMITS.requirements && { key: 'limit_reached', params: { max: LIMITS.requirements } }` |
| src/components/invoice/BusinessInvoiceCard.tsx:140 | Add the details to older invoice | busy | `reissueMany.isPending` |
| src/components/invoice/BusinessInvoiceCard.tsx:196 | Save | busy | `save.isPending` |
| src/components/invoice/BusinessInvoiceCard.tsx:218 | Add the details | busy | `reissueMany.isPending` |
| src/components/invoice/InvoiceBusinessSection.tsx:63 | (icon) | busy | `reissue.isPending` |
| src/components/invoice/InvoiceBusinessSection.tsx:123 | (icon) | busy | `reissue.isPending` |
| src/components/invoice/InvoiceDetailsDialog.tsx:202 | Confirm payment | reason + busy | `!bankReference.trim() && 'payment_reference_missing'` |
| src/components/invoice/InvoiceDisputeSection.tsx:293 | Cancel | busy | `submitting` |
| src/components/invoice/InvoiceDisputeSection.tsx:296 | (icon) | busy | `submitting` |
| src/components/invoice/PayInvoiceCard.tsx:156 | Pay by card | reason + busy | `!agreed && 'tick_confirmation_first'` |
| src/components/invoice/PayInvoiceCard.tsx:238 | I have paid | reason + busy | `[!reference.trim() && 'payment_reference_missing', !date && 'choose_date_first']` |
| src/components/invoice/PayInvoiceCard.tsx:266 | I have paid | reason + busy | `[!reference.trim() && 'payment_reference_missing', !date && 'choose_date_first']` |
| src/components/invoice/PayInvoiceCard.tsx:292 | Payment reported on MMM d, yyyy - waiting for confirmation | reason | `"pending_admin_review"` |
| src/components/nda/NdaSignForm.tsx:241 | Cancel | busy | `busy` |
| src/components/nda/NdaSignForm.tsx:242 | (icon) | reason + busy | `problems.length > 0 && { key: 'signature_incomplete', message: t('ndaSign.problem.${problems[0]}'), onNext: () => document.getElementById('nda-${FIELD_OF[proble` |
| src/components/nda/NdaStatusCard.tsx:104 | ndaSign.card.downloadMine | reason + busy | `!s.nda_id && 'no_data_yet'` |
| src/components/nda/NdaStatusCard.tsx:112 | ndaSign.card.remind | reason + busy | `!v.canRemind && { key: 'rate_limit_soon', message: v.nextReminderAt ? t('ndaSign.card.nextReminder', { date: fmt(v.nextReminderAt, lang) }) : undefined }` |
| src/components/nda/NdaStatusCard.tsx:123 | ndaSign.card.downloadFull | busy | `downloading` |
| src/components/nda/SignaturePad.tsx:205 | (icon) | busy | `disabled` |
| src/components/nda/SignaturePad.tsx:208 | (icon) | busy | `disabled` |
| src/components/referral/tracking/ReferralEarnings.tsx:208 | CSV ({{n}} rows) | reason | `shown.length === 0 && 'nothing_to_export'` |
| src/components/referral/tracking/ReferralEarnings.tsx:265 | Previous | reason | `pg.page <= 1 && 'first_page'` |
| src/components/referral/tracking/ReferralEarnings.tsx:266 | Next | reason | `pg.page >= pg.pages && 'last_page'` |
| src/components/sla/SlaAcceptanceBox.tsx:66 | sla.accept.counterSend | reason + busy | `!(Number(r) > 0 && Number(res) > Number(r)) && 'invalid_value'` |
| src/components/sla/SlaPolicyCenter.tsx:80 | (icon) | busy | `busy` |
| src/components/sla/SlaPolicyCenter.tsx:82 | sla.center.fromDefault | busy | `busy` |
| src/components/sla/SlaPolicyEditor.tsx:156 | sla.editor.duplicate | busy | `busy` |
| src/components/sla/SlaPolicyEditor.tsx:212 | (icon) | reason | `!bounds.allowed_coverage.includes(m) && 'coverage_not_allowed'` |
| src/components/sla/SlaPolicyEditor.tsx:239 | sla.editor.addHoliday | reason | `!newHoliday && 'choose_date_first'` |
| src/components/sla/SlaPolicyEditor.tsx:317 | sla.editor.addStep | reason | `sev.escalations.length >= bounds.max_escalations && { key: 'limit_reached', params: { max: bounds.max_escalations } }` |
| src/components/sla/SlaPolicyEditor.tsx:326 | sla.editor.add | reason | `!contact.includes('@') && 'invalid_email'` |
| src/components/sla/SlaPolicyEditor.tsx:371 | sla.editor.saveDraft | reason + busy | `!dirty && 'nothing_changed'` |
| src/components/sla/SlaPolicyEditor.tsx:372 | sla.editor.activate | reason + busy | `[dirty && 'save_changes_first', errors && 'fix_errors_first']` |
| src/components/sla/SlaPolicyEditor.tsx:374 | sla.editor.archive | busy | `busy` |
| src/components/sla/SlaPolicyEditor.tsx:392 | sla.editor.activateConfirm | busy | `busy` |
| src/components/sla/SlaTicketPanel.tsx:97 | sla.panel.applyNew | busy | `act.isPending` |
| src/components/sla/SlaTicketPanel.tsx:103 | sla.action.accept | busy | `act.isPending` |
| src/components/sla/SlaTicketPanel.tsx:104 | sla.action.decline | busy | `act.isPending` |
| src/components/sla/SlaTicketPanel.tsx:110 | sla.action.accept | busy | `act.isPending` |
| src/components/sla/SlaTicketPanel.tsx:111 | sla.action.decline | busy | `act.isPending` |
| src/components/sla/SlaTicketPanel.tsx:119 | sla.choice.reassign | busy | `act.isPending` |
| src/components/sla/SlaTicketPanel.tsx:120 | sla.choice.admin_help | busy | `act.isPending` |
| src/components/sla/SlaTicketPanel.tsx:178 | sla.action.confirm | reason + busy | `(dlg === 'reclass' \|\| dlg === 'propose') && note.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }` |
| src/components/timesheet/SubmitTimesheetDialog.tsx:91 | Cancel | busy | `busy` |
| src/components/timesheet/SubmitTimesheetDialog.tsx:92 | (icon) | reason + busy | `!!blockReason && { key: entries.length ? 'rate_not_approved' : 'no_work_logged', message: blockReason }` |
| src/components/timesheet/TimesheetRateCard.tsx:183 | Send to the client for approval | busy | `busy` |
| src/components/timesheet/TimesheetRateCard.tsx:188 | Cancel | busy | `busy` |
| src/components/timesheet/TimesheetRateCard.tsx:244 | Approve this rate | busy | `busy` |
| src/components/timesheet/TimesheetRateCard.tsx:248 | Decline... | busy | `busy` |
| src/components/timesheet/TimesheetRateCard.tsx:274 | Cancel | busy | `busy` |
| src/components/timesheet/TimesheetRateCard.tsx:275 | Decline the rate | reason + busy | `reason.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }` |
| src/components/timesheet/TimesheetSubmissions.tsx:272 | Send comment | reason + busy | `!commentText.trim() && 'type_message_first'` |
| src/components/timesheet/TimesheetSubmissions.tsx:292 | Cancel | busy | `busy` |
| src/components/timesheet/TimesheetSubmissions.tsx:293 | Approve the timesheet | busy | `busy` |
| src/components/timesheet/TimesheetSubmissions.tsx:309 | Cancel | busy | `busy` |
| src/components/timesheet/TimesheetSubmissions.tsx:310 | Send to the consultant | reason + busy | `note.trim().length < 3 && { key: 'reason_required', params: { min: 3 } }` |
| src/components/timesheet/WorkLogDialog.tsx:169 | Cancel | busy | `saving` |
| src/components/timesheet/WorkLogDialog.tsx:170 | (icon) | busy | `saving` |
| src/components/tracking/TicketTrackingPanel.tsx:124 | tracking.confirm.yes | busy | `quick.isPending` |
| src/components/tracking/TrackingSettingsCard.tsx:121 | {t('tracking.admin.up')} | reason | `i === 0 && 'already_first'` |
| src/components/tracking/TrackingSettingsCard.tsx:122 | {t('tracking.admin.down')} | reason | `i === draft.statuses.length - 1 && 'already_last'` |
| src/components/tracking/TrackingSettingsCard.tsx:161 | (icon) | busy | `busy` |
| src/components/tracking/TrackingTimeline.tsx:59 | CSV | reason | `!rows.length && 'nothing_to_export'` |
| src/components/tracking/TrackingTimeline.tsx:60 | PDF | reason + busy | `!rows.length && 'nothing_to_export'` |
| src/components/tracking/WorkingStatusDialog.tsx:123 | (icon) | reason + busy | `!key && 'choose_option_first'` |

### Sign-in (19)

| File | Label | Type | Condition |
|---|---|---|---|
| src/components/auth/ConfirmLinkProblem.tsx:102 | (icon) | reason + busy | `cooldown > 0 && { key: 'rate_limit', params: { minutes: Math.max(1, Math.ceil(cooldown / 60)) } }` |
| src/components/auth/ConfirmLinkProblem.tsx:129 | Confirm | busy | `checking` |
| src/components/auth/SocialSignInButtons.tsx:53 | (icon) | busy | `!!loadingProvider \|\| disabled` |
| src/components/auth/TwoFactorGate.tsx:88 | Continue | reason + busy | `code.length !== 6 && 'invalid_value'` |
| src/components/auth/VerificationTimeline.tsx:184 | { resending ? t('auth.verification.resend_sending') : resendCooldown > 0 ? t('auth.verification.resend_cooldown', { seconds: resendCooldown }) : t('auth.verific | reason + busy | `resendCooldown > 0 && { key: 'rate_limit', params: { minutes: Math.max(1, Math.ceil(resendCooldown / 60)) } }` |
| src/pages/auth/ConfirmEmailPage.tsx:73 | Confirm my e-mail | busy | `state === 'busy'` |
| src/pages/auth/ForgotPasswordPage.tsx:68 | auth.forgot_btn | busy | `loading` |
| src/pages/auth/LoginPage.tsx:541 | I need SAP support (Client) | busy | `!!choosingRole` |
| src/pages/auth/LoginPage.tsx:545 | I am an SAP consultant (Consultant) | busy | `!!choosingRole` |
| src/pages/auth/LoginPage.tsx:585 | Try again | busy | `!!oauthLoading` |
| src/pages/auth/LoginPage.tsx:601 | (icon) | reason + busy | `!!(lockoutUntil && Date.now() < lockoutUntil) && rateLimitReason(lockoutUntil)` |
| src/pages/auth/LoginPage.tsx:635 | (icon) | reason + busy | `resendCooldown > 0 && { key: 'rate_limit', params: { minutes: Math.max(1, Math.ceil(resendCooldown / 60)) } }` |
| src/pages/auth/LoginPage.tsx:646 | (icon) | reason + busy | `resendCooldown > 0 && { key: 'rate_limit', params: { minutes: Math.max(1, Math.ceil(resendCooldown / 60)) } }` |
| src/pages/auth/OAuthConsentPage.tsx:74 | Deny | busy | `busy` |
| src/pages/auth/OAuthConsentPage.tsx:75 | Approve | busy | `busy` |
| src/pages/auth/ResetPasswordPage.tsx:257 | auth.reset_btn | busy | `loading` |
| src/pages/auth/SignupPage.tsx:327 | (icon) | reason + busy | `resendCooldown > 0 && { key: 'rate_limit', params: { minutes: Math.max(1, Math.ceil(resendCooldown / 60)) } }` |
| src/pages/auth/SignupPage.tsx:444 | auth.signup_btn | busy | `loading` |
| src/pages/auth/SignupPage.tsx:449 | Sign up with Google | reason + busy | `!agreed && 'tick_confirmation_first'` |

### Shared (5)

| File | Label | Type | Condition |
|---|---|---|---|
| src/components/ui/carousel.tsx:173 | (icon) | reason | `!canScrollPrev && 'already_first'` |
| src/components/ui/carousel.tsx:201 | (icon) | reason | `!canScrollNext && 'already_last'` |
| src/components/ui/TimeSlotPicker.tsx:176 | Add This Slot | reason | `!selectedDate && 'choose_date_first'` |
| src/components/ui/voice-input.tsx:69 | {`${t('voice.language', 'Voice language')}: ${current.label}`} | reason | `[disabled && 'another_action_running', voice.listening && 'recording_in_progress']` |
| src/components/ui/voice-input.tsx:96 | {voice.listening ? t('voice.stop', 'Stop recording') : t('voice.start', 'Start voice input')} | reason + busy | `disabled && 'another_action_running'` |

### Other (84)

| File | Label | Type | Condition |
|---|---|---|---|
| src/components/chat/ChatInput.tsx:101 | (icon) | opt-out | `pass-through, parent must supply reason; OWNER parent outside batch ` |
| src/components/chat/ChatInput.tsx:133 | (icon) | reason | `[disabled && 'not_editable_now', !canSend && 'type_message_first']` |
| src/components/chatbot/AIChatbot.tsx:371 | (icon) | opt-out | `busy ` |
| src/components/chatbot/AIChatbot.tsx:475 | "Send message" | reason + busy | `!input.trim() && 'type_message_first'` |
| src/components/favourites/FavouriteButton.tsx:108 | (icon) | opt-out | `busy ` |
| src/components/favourites/GroupEditorDialog.tsx:110 | fav.save | busy | `saving` |
| src/components/favourites/GroupInvitePanel.tsx:134 | fav.untick_all | reason + busy | `chosen.length === 0 && 'select_items_first'` |
| src/components/favourites/GroupInvitePanel.tsx:135 | fav.whole_group | reason + busy | `preview.ask.length === 0 && 'no_recipients'` |
| src/components/favourites/GroupInvitePanel.tsx:136 | ( ) | reason + busy | `chosen.length === 0 && 'select_items_first'` |
| src/components/favourites/NoteDialog.tsx:52 | fav.save | reason + busy | `[tooLong && { key: 'text_too_long', params: { max: FAV_LIMITS.note } }, !!parsed.error && { key: 'invalid_value', message: parsed.error }]` |
| src/components/feedback/FeedbackDialog.tsx:244 | (icon) | reason | `files.length >= FEEDBACK_LIMITS.files && { key: 'limit_reached', params: { max: FEEDBACK_LIMITS.files } }` |
| src/components/feedback/FeedbackDialog.tsx:248 | (icon) | reason + busy | `files.length >= FEEDBACK_LIMITS.files && { key: 'limit_reached', params: { max: FEEDBACK_LIMITS.files } }` |
| src/components/feedback/FeedbackDialog.tsx:316 | (icon) | busy | `sending` |
| src/components/interview/InterviewResponsesCard.tsx:117 | Use this time | busy | `busy !== null` |
| src/components/interview/InterviewResponsesCard.tsx:152 | Send invitation e-mails again | busy | `busy !== null` |
| src/components/interview/InterviewRsvpCard.tsx:69 | Accept | reason + busy | `status === 'accepted' && 'already_done'` |
| src/components/interview/InterviewRsvpCard.tsx:72 | Suggest another time | busy | `saving` |
| src/components/interview/InterviewRsvpCard.tsx:75 | Decline | busy | `saving` |
| src/components/interview/InterviewRsvpCard.tsx:93 | Send suggestions | busy | `saving` |
| src/components/interview/InterviewRsvpCard.tsx:102 | Confirm decline | busy | `saving` |
| src/components/knowledge/KnowledgeArticleDialog.tsx:153 | Send for review | reason + busy | `!!problemText && { key: 'fix_errors_first', message: problemText }` |
| src/components/knowledge/SapDocsCard.tsx:94 | (icon) | busy | `importer.stopping` |
| src/components/knowledge/SapDocsCard.tsx:99 | (icon) | reason | `!!importer.busy && 'another_action_running'` |
| src/components/knowledge/SapDocsCard.tsx:111 | Remove | reason | `!!importer.busy && 'another_action_running'` |
| src/components/landing/ContactSection.tsx:99 | contact.submit | busy | `sending` |
| src/components/landing/DemoRequestWizard.tsx:379 | Back | reason + busy | `step === 0 && 'first_page'` |
| src/components/landing/DemoRequestWizard.tsx:393 | Continue | reason | `!canNext && (step === 0 ? 'choose_option_first' : step === 1 ? (!time ? 'choose_option_first' : 'choose_time_first') : name.trim().length <= 1 ? { key: 'text_to` |
| src/components/landing/DemoRequestWizard.tsx:401 | (icon) | reason + busy | `!canNext && (step === 0 ? 'choose_option_first' : step === 1 ? (!time ? 'choose_option_first' : 'choose_time_first') : name.trim().length <= 1 ? { key: 'text_to` |
| src/components/landing/DemoRequestWizard.tsx:651 | (icon) | reason | `[!date && 'choose_date_first', !!date && slotIsPast(s) && 'date_in_past']` |
| src/components/match/MatchClarifyingQuestions.tsx:52 | (icon) | reason | `!filled && 'answer_required'` |
| src/components/meetings/ScheduleMeetingButton.tsx:43 | (icon) | reason + busy | `scheduleReason(block, lang, noConsultantStep)` |
| src/components/notifications/NotificationPauseCard.tsx:42 | Resume now | busy | `resume.isPending` |
| src/components/notifications/PauseNotificationsDialog.tsx:137 | Pause for {{d}} | reason + busy | `invalid && 'invalid_value'` |
| src/components/onboarding/EmailVerificationBanner.tsx:60 | (icon) | busy | `sending` |
| src/components/profile/GroupedMultiSelect.tsx:117 | Add | reason | `[!otherText.trim() && 'fill_required_fields', atMax && { key: 'limit_reached', params: { max } }]` |
| src/components/profile/ProfileEditDialog.tsx:247 | (icon) | busy | `saving` |
| src/components/referral/EmailInviteForm.tsx:102 | (icon) | busy | `sending` |
| src/components/referral/ReferEarnStep.tsx:137 | (icon) | reason | `ov.disabled && 'feature_disabled_by_admin'` |
| src/components/referral/ReferEarnStep.tsx:218 | Link this code | reason + busy | `[result === 'ok' && 'already_done', check.state !== 'valid' && 'invalid_value']` |
| src/components/referral/ReferralAckPanel.tsx:62 | Accept and continue | reason + busy | `!agreed && 'tick_confirmation_first'` |
| src/components/referral/rules/RulesSimulator.tsx:96 | Use my real numbers | busy | `loading` |
| src/components/remote/AnyDeskPanel.tsx:265 | Save | busy | `setAlias.isPending` |
| src/components/remote/CredentialsManager.tsx:276 | (icon) | reason | `(!username \|\| !password) && 'invalid_value'` |
| src/components/remote/RDPWebClientPanel.tsx:185 | Save | reason | `(!name \|\| !hostname \|\| !isValidConnectionId(protocol, '${hostname.trim()}:${port.trim() \|\| '3389'}')) && 'invalid_value'` |
| src/components/remote/RustDeskPanel.tsx:149 | Save | reason | `(!alias \|\| !rdId \|\| !isValidConnectionId('rustdesk', rdId)) && 'invalid_value'` |
| src/components/remote/SharedConfigsClientPanel.tsx:85 | Resend | busy | `resend.isPending` |
| src/components/remote/SharedConfigsClientPanel.tsx:90 | Revoke | busy | `revoke.isPending` |
| src/components/remote/SharedConfigsConsultantPanel.tsx:123 | Accept | busy | `accept.isPending` |
| src/components/remote/SharedConfigsConsultantPanel.tsx:135 | Connect | reason | `(!idValid) && 'invalid_value'` |
| src/components/remote/ShareRemoteConfigDialog.tsx:214 | (icon) | reason + busy | `[!isValidConnectionId(toolType, connectionId) && 'invalid_value', shareMode === 'consultant' ? !consultantId && 'no_consultant_selected' : !recipientEmail && 'f` |
| src/components/remote/TeamViewerPanel.tsx:149 | Save | reason | `(!alias \|\| !tvId \|\| !isValidConnectionId('teamviewer', tvId)) && 'invalid_value'` |
| src/components/remote/VMwareSettingsForm.tsx:239 | Save Settings | busy | `saving` |
| src/components/satisfaction/RequestSatisfactionDialog.tsx:52 | (icon) | reason + busy | `!selected && 'choose_option_first'` |
| src/components/satisfaction/SatisfactionSurveyDialog.tsx:109 | (icon) | reason + busy | `!allRated && 'give_rating_first'` |
| src/components/session/AnalyzeSessionButton.tsx:39 | (icon) | busy | `loading` |
| src/components/session/PreflightTestDialog.tsx:670 | preflight.retest | busy | `status === 'requesting'` |
| src/components/session/PreflightTestDialog.tsx:674 | (icon) | reason | `proceedDisabled && { key: 'previous_step_incomplete', message: t('preflight.blocked_next', 'Finish the device check and enable a microphone or camera to continu` |
| src/components/session/PreJoinChecklist.tsx:300 | checklist.rerun | busy | `running` |
| src/components/session/RateSessionDialog.tsx:386 | Cancel | busy | `submit.isPending` |
| src/components/session/RateSessionDialog.tsx:389 | (icon) | reason + busy | `score === 0 && 'give_rating_first'` |
| src/components/session/SessionSurveyDialog.tsx:151 | (icon) | busy | `submitMutation.isPending` |
| src/components/sidebar/SidebarNav.tsx:276 | (icon) | reason | `searching && { key: 'previous_step_incomplete', message: t('sidebar.clear_search_first', 'Clear the search to collapse this group.') }` |
| src/components/ticket/SapAreaPicker.tsx:148 | (icon) | reason | `blocked && { key: 'limit_reached', params: { max: MAX_SAP_AREAS } }` |
| src/components/ticket/SapAreaPicker.tsx:187 | (icon) | reason | `!otherSelected && atLimit && { key: 'limit_reached', params: { max: MAX_SAP_AREAS } }` |
| src/components/ticket/SapNotesField.tsx:67 | Add | reason | `[!text.trim() && 'fill_required_fields', value.length >= MAX_NOTES_TRIED && { key: 'limit_reached', params: { max: MAX_NOTES_TRIED } }]` |
| src/components/ticket/SolutionSuggestions.tsx:287 | Helpful | reason | `!!verdicts[i] && 'already_done'` |
| src/components/ticket/SolutionSuggestions.tsx:293 | Not helpful | reason | `!!verdicts[i] && 'already_done'` |
| src/components/ticket/SolutionSuggestions.tsx:305 | This solved my problem | busy | `sending` |
| src/components/tour/ProductTour.tsx:272 | Back | reason | `index === 0 && 'first_page'` |
| src/components/voice/MicCheck.tsx:70 | (icon) | busy | `voice.status === 'starting'` |
| src/pages/DemoRequestConfirmationPage.tsx:507 | Cancel | busy | `submitting` |
| src/pages/DemoRequestConfirmationPage.tsx:510 | Submit reschedule | reason + busy | `slotErrors.some((e) => e !== null) && 'fix_errors_first'` |
| src/pages/interview/InterviewRespondPage.tsx:204 | (icon) | busy | `saving` |
| src/pages/interview/LiveInterviewPage.tsx:254 | "Send" | reason + busy | `!input.trim() && 'type_message_first'` |
| src/pages/interview/LiveInterviewPage.tsx:265 | Suggest next questions | busy | `suggesting` |
| src/pages/interview/LiveInterviewPage.tsx:283 | Save note | reason | `!note.trim() && 'fill_required_fields'` |
| src/pages/interview/LiveInterviewPage.tsx:301 | Finish interview | busy | `finishing` |
| src/pages/NotificationPausePage.tsx:100 | Also mark me unavailable for new requests during this period (recommended) | busy | `busy` |
| src/pages/NotificationPausePage.tsx:109 | Resume now | busy | `busy` |
| src/pages/NotificationPausePage.tsx:114 | Try again | busy | `busy` |
| src/pages/notifications/NotificationsPage.tsx:196 | Mark as read | reason + busy | `selectedCount === 0 && 'select_items_first'` |
| src/pages/notifications/NotificationsPage.tsx:228 | Try again | busy | `busy` |
| src/pages/notifications/NotificationsPage.tsx:355 | (icon) | busy | `busy` |
| src/pages/superadmin/AuditLogsPage.tsx:72 | Refresh | busy | `isRefetching` |

## Arabic strings (reason catalogue)

113 reasons. Message = the sentence; Next = the next-step label.

| Key | Part | English | Arabic |
|---|---|---|---|
| no_consultant_assigned | message | A consultant must be assigned first. | يجب تعيين مستشار أولًا. |
| no_consultant_assigned | next | Go to Bids | الانتقال إلى العروض |
| no_consultant_selected | message | Choose a consultant first. | اختر مستشارًا أولًا. |
| ticket_closed | message | This request is closed, so this is no longer possible. | هذا الطلب مغلق، لذلك لم يعد هذا ممكنًا. |
| not_ticket_owner | message | Only the person who opened this request can do this. | يمكن فقط لمن فتح هذا الطلب القيام بذلك. |
| not_assigned_to_you | message | You are not assigned to this request. | أنت غير معيّن على هذا الطلب. |
| rate_not_approved | message | The hourly rate must be approved first. | يجب اعتماد سعر الساعة أولًا. |
| rate_not_approved | next | Review the rate | مراجعة السعر |
| engagement_not_confirmed | message | The engagement must be confirmed by both sides first. | يجب أن يؤكد الطرفان الارتباط أولًا. |
| engagement_not_confirmed | next | Open the checklist | فتح قائمة التحقق |
| sla_not_accepted | message | Accept the SLA targets for this request first. | اقبل أهداف اتفاقية مستوى الخدمة لهذا الطلب أولًا. |
| sla_not_accepted | next | Review the SLA | مراجعة اتفاقية مستوى الخدمة |
| brd_not_approved | message | The business requirements document must be approved first. | يجب اعتماد مستند متطلبات العمل أولًا. |
| brd_not_approved | next | Open the BRD | فتح مستند المتطلبات |
| brd_not_submitted | message | Submit a business requirements document version first. | أرسل نسخة من مستند متطلبات العمل أولًا. |
| brd_not_submitted | next | Open the BRD | فتح مستند المتطلبات |
| bids_closed | message | Bidding for this request has closed. | أُغلق باب العروض لهذا الطلب. |
| no_bids_yet | message | No bids have arrived yet. | لم تصل أي عروض بعد. |
| work_not_started | message | Work on this request has not started yet. | لم يبدأ العمل على هذا الطلب بعد. |
| no_work_logged | message | Log your working hours first. | سجّل ساعات العمل أولًا. |
| no_work_logged | next | Log hours | تسجيل الساعات |
| timesheet_not_submitted | message | The timesheet has not been submitted yet. | لم يُرسل سجل الساعات بعد. |
| csat_not_ready | message | A satisfaction survey can be requested once the work is resolved. | يمكن طلب استبيان الرضا بعد حل المشكلة. |
| outside_availability | message | This time is outside the consultant's working hours. | هذا الوقت خارج ساعات عمل المستشار. |
| outside_availability | next | Pick another time | اختر وقتًا آخر |
| team_full | message | The team is already full. | اكتمل الفريق بالفعل. |
| agreement_not_active | message | The support agreement must be active first. | يجب أن تكون اتفاقية الدعم نشطة أولًا. |
| agreement_not_active | next | Open the agreement | فتح الاتفاقية |
| crew_not_confirmed | message | Every crew member must accept their place first. | يجب أن يقبل كل أعضاء الفريق أماكنهم أولًا. |
| crew_not_confirmed | next | Open the team checklist | فتح قائمة الفريق |
| terms_not_accepted | message | Both sides must accept the agreement terms first. | يجب أن يقبل الطرفان شروط الاتفاقية أولًا. |
| terms_not_accepted | next | Review the terms | مراجعة الشروط |
| start_date_not_reached | message | The start date has not been reached yet. | لم يحن تاريخ البدء بعد. |
| meeting_not_started | message | The meeting has not started yet. | لم يبدأ الاجتماع بعد. |
| nda_not_signed_by_you | message | You must sign the NDA first. | يجب أن توقّع اتفاقية عدم الإفصاح أولًا. |
| nda_not_signed_by_you | next | Sign the NDA | توقيع اتفاقية عدم الإفصاح |
| nda_waiting_other_party | message | Waiting for the {{party}} to sign the NDA. | بانتظار توقيع {{party}} على اتفاقية عدم الإفصاح. |
| nda_waiting_other_party | next | Send a reminder | إرسال تذكير |
| nda_not_signed | message | An NDA signed by both sides is needed first. | يلزم أولًا اتفاقية عدم إفصاح موقّعة من الطرفين. |
| nda_not_signed | next | Open the NDA | فتح اتفاقية عدم الإفصاح |
| nda_revoked | message | The NDA was revoked. A new NDA is needed. | أُلغيت اتفاقية عدم الإفصاح. يلزم توقيع اتفاقية جديدة. |
| nda_revoked | next | Open the NDA | فتح اتفاقية عدم الإفصاح |
| signature_incomplete | message | Complete every signing item first. | أكمل كل بنود التوقيع أولًا. |
| payment_not_confirmed | message | The payment must be confirmed first. | يجب تأكيد الدفع أولًا. |
| payment_not_confirmed | next | Open invoices | فتح الفواتير |
| invoice_not_approved | message | The invoice must be approved first. | يجب اعتماد الفاتورة أولًا. |
| missing_payout_details | message | Add your payout details first. | أضف بيانات صرف المستحقات أولًا. |
| missing_payout_details | next | Add payout details | إضافة بيانات الصرف |
| no_bank_account | message | Add a bank account first. | أضف حسابًا بنكيًا أولًا. |
| no_bank_account | next | Add a bank account | إضافة حساب بنكي |
| minimum_payout_not_reached | message | Your balance is below the minimum payout of {{amount}}. | رصيدك أقل من الحد الأدنى للصرف وهو {{amount}}. |
| nothing_to_pay | message | There is nothing to pay yet. | لا يوجد شيء للدفع بعد. |
| payment_reference_missing | message | Enter the payment reference first. | أدخل مرجع الدفع أولًا. |
| profile_incomplete | message | Complete your profile first. | أكمل ملفك الشخصي أولًا. |
| profile_incomplete | next | Complete your profile | إكمال الملف الشخصي |
| profile_missing_fields | message | Complete your profile first: {{fields}}. | أكمل ملفك الشخصي أولًا: {{fields}}. |
| profile_missing_fields | next | Complete your profile | إكمال الملف الشخصي |
| location_missing | message | Add your country and city first. | أضف بلدك ومدينتك أولًا. |
| location_missing | next | Add your location | إضافة موقعك |
| ai_interview_not_passed | message | You need to pass the AI interview first. | يجب أن تجتاز المقابلة بالذكاء الاصطناعي أولًا. |
| ai_interview_not_passed | next | Start the interview | بدء المقابلة |
| verification_pending | message | Your profile is waiting for verification. | ملفك الشخصي بانتظار التحقق. |
| verification_pending | next | See verification status | عرض حالة التحقق |
| policy_not_accepted | message | Accept the consultant policy first. | اقبل سياسة المستشارين أولًا. |
| policy_not_accepted | next | Read the policy | قراءة السياسة |
| availability_not_set | message | Set your weekly availability first. | حدّد أوقات توفرك الأسبوعية أولًا. |
| availability_not_set | next | Set availability | تحديد التوفر |
| on_hold | message | Your account is on hold right now. | حسابك في وضع الإيقاف المؤقت حاليًا. |
| on_hold | next | Manage availability | إدارة التوفر |
| email_not_confirmed | message | Confirm your e-mail address first. | أكّد بريدك الإلكتروني أولًا. |
| feature_disabled_by_admin | message | Not available yet. | غير متاح بعد. |
| feature_not_ready | message | This part is still being prepared. | هذا الجزء قيد التجهيز. |
| permission_missing | message | Your role ({{role}}) cannot do this. | دورك ({{role}}) لا يسمح بذلك. |
| admin_only | message | Only administrators can do this. | يمكن للمسؤولين فقط القيام بذلك. |
| rate_limit | message | Please try again in {{minutes}} min. | يرجى المحاولة مرة أخرى بعد {{minutes}} دقيقة. |
| rate_limit_soon | message | Too many tries. Please wait a moment and try again. | محاولات كثيرة. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى. |
| pending_admin_review | message | Waiting for an administrator to review this. | بانتظار مراجعة أحد المسؤولين. |
| already_done | message | Already done. | تمّ بالفعل. |
| offline | message | You are offline. Reconnect to continue. | أنت غير متصل. أعد الاتصال للمتابعة. |
| sign_in_required | message | Sign in first. | سجّل الدخول أولًا. |
| sign_in_required | next | Sign in | تسجيل الدخول |
| fill_required_fields | message | Fill in the required fields first. | املأ الحقول المطلوبة أولًا. |
| field_required | message | Enter {{field}} first. | أدخل {{field}} أولًا. |
| type_message_first | message | Type a message first. | اكتب رسالة أولًا. |
| text_too_short | message | Write at least {{min}} characters. | اكتب {{min}} أحرف على الأقل. |
| text_too_long | message | The text is too long (maximum {{max}} characters). | النص طويل جدًا (الحد الأقصى {{max}} حرفًا). |
| reason_required | message | Give a reason first (at least {{min}} characters). | اذكر سببًا أولًا ({{min}} أحرف على الأقل). |
| choose_option_first | message | Choose an option first. | اختر خيارًا أولًا. |
| select_items_first | message | Select at least one item first. | حدّد عنصرًا واحدًا على الأقل أولًا. |
| choose_date_first | message | Choose a date first. | اختر تاريخًا أولًا. |
| choose_time_first | message | Choose a date and time first. | اختر التاريخ والوقت أولًا. |
| date_in_past | message | This time is in the past. Choose a later time. | هذا الوقت في الماضي. اختر وقتًا لاحقًا. |
| upload_file_first | message | Choose a file first. | اختر ملفًا أولًا. |
| tick_confirmation_first | message | Tick the confirmation box first. | ضع علامة في مربع التأكيد أولًا. |
| give_rating_first | message | Choose a rating first. | اختر تقييمًا أولًا. |
| fix_errors_first | message | Fix the highlighted problems first. | أصلح المشكلات المميّزة أولًا. |
| invalid_value | message | Check the value you entered. | تحقق من القيمة التي أدخلتها. |
| invalid_email | message | Enter a valid e-mail address. | أدخل بريدًا إلكترونيًا صحيحًا. |
| nothing_changed | message | No changes to save yet. | لا توجد تغييرات للحفظ بعد. |
| save_changes_first | message | Save your changes first. | احفظ تغييراتك أولًا. |
| limit_reached | message | The limit of {{max}} is reached. | تم الوصول إلى الحد الأقصى وهو {{max}}. |
| minimum_items | message | At least {{min}} must remain. | يجب أن يبقى {{min}} على الأقل. |
| type_to_confirm | message | Type {{word}} to confirm. | اكتب {{word}} للتأكيد. |
| same_as_current | message | This is already the current value. | هذه هي القيمة الحالية بالفعل. |
| not_in_list | message | This is not in the list. | هذا ليس ضمن القائمة. |
| already_added | message | Already added. | تمت الإضافة بالفعل. |
| answer_required | message | Answer this question first. | أجب عن هذا السؤال أولًا. |
| previous_step_incomplete | message | Finish this step first. | أكمل هذه الخطوة أولًا. |
| nothing_to_export | message | There is nothing to export yet. | لا يوجد شيء للتصدير بعد. |
| no_data_yet | message | There is nothing here yet. | لا يوجد شيء هنا بعد. |
| first_page | message | This is the first page. | هذه هي الصفحة الأولى. |
| last_page | message | This is the last page. | هذه هي الصفحة الأخيرة. |
| already_first | message | This is already at the top. | هذا في الأعلى بالفعل. |
| already_last | message | This is already at the bottom. | هذا في الأسفل بالفعل. |
| loading_data | message | Still loading. Please wait a moment. | جارٍ التحميل. يرجى الانتظار قليلًا. |
| another_action_running | message | Please wait until the current action finishes. | يرجى الانتظار حتى ينتهي الإجراء الحالي. |
| recording_in_progress | message | Stop the recording first. | أوقف التسجيل أولًا. |
| ai_answering | message | Wait until the assistant has finished answering. | انتظر حتى ينتهي المساعد من الإجابة. |
| in_use | message | This is still in use, so it cannot be removed. | هذا ما زال قيد الاستخدام، لذلك لا يمكن حذفه. |
| is_default | message | This is the default and cannot be removed. | هذا هو الخيار الافتراضي ولا يمكن حذفه. |
| is_yourself | message | You cannot do this to your own account. | لا يمكنك القيام بذلك على حسابك. |
| expired | message | This has expired. | انتهت صلاحية هذا. |
| not_editable_now | message | This can no longer be changed. | لم يعد بالإمكان تغيير هذا. |
| no_recipients | message | Choose at least one recipient first. | اختر مستلمًا واحدًا على الأقل أولًا. |
| too_many_recipients | message | Too many recipients selected (maximum {{max}}). | تم اختيار عدد كبير من المستلمين (الحد الأقصى {{max}}). |
| preview_first | message | Preview the message first. | اعرض معاينة الرسالة أولًا. |
| auth_user_id_missing | message | The account ID is unavailable; reload the user details before trying again. | معرّف الحساب غير متاح؛ أعد تحميل تفاصيل المستخدم قبل المحاولة مجددًا. |
| signature_anonymised | message | This signature has been anonymised; its original details are no longer available. | أُخفيت هوية صاحب هذا التوقيع؛ لم تعد تفاصيله الأصلية متاحة. |
| demo_read_only | message | This demo is read-only; open a live profile to make changes. | هذا العرض التجريبي للقراءة فقط؛ افتح ملفًا فعليًا لإجراء تغييرات. |
| no_interviewer_available | message | No interviewer is available; add another administrator or a verified consultant first. | لا يوجد محاور متاح؛ أضف مسؤولًا آخر أو مستشارًا موثّقًا أولًا. |
| crop_too_large | message | The crop exceeds 2 MB; choose a smaller crop or image. | يتجاوز حجم الصورة المقصوصة ٢ ميبيبايت؛ اختر اقتصاصًا أو صورة أصغر. |
| crop_not_ready | message | The crop is not ready; adjust the crop or choose another image. | الاقتصاص غير جاهز؛ عدّل الاقتصاص أو اختر صورة أخرى. |
| announcement_test_required | message | Send a test announcement first. | أرسل إعلانًا تجريبيًا أولًا. |
| no_eligible_recipients | message | No eligible recipients remain; check the recipient counts. | لم يتبقّ مستلمون مؤهلون؛ تحقّق من أعداد المستلمين. |
| client_information_not_submitted | message | Wait for the client to submit their information first. | انتظر حتى يرسل العميل معلوماته أولًا. |
| reply_recipient_unavailable | message | A reply needs a user account or consent to receive an email; check the contact details. | يتطلب الرد حساب مستخدم أو موافقة على تلقي بريد إلكتروني؛ تحقّق من بيانات الاتصال. |
| ai_learning_disabled | message | Enable AI learning before generating drafts. | فعّل التعلّم بالذكاء الاصطناعي قبل إنشاء المسودات. |
| company_admin_only | message | Only company owners and administrators can do this. Ask a company administrator. | يمكن فقط لمالكي الشركة ومسؤوليها القيام بذلك. اطلب ذلك من أحد مسؤولي الشركة. |
| choose_two_versions | message | Select exactly two versions to compare. | حدّد نسختين بالضبط للمقارنة. |
| coverage_not_allowed | message | Choose a coverage mode allowed by the administrator. | اختر نمط تغطية يسمح به المسؤول. |

Popover/UI strings (in `guided-button.tsx`): "Why is this dimmed?" / "لماذا هذا الزر غير متاح؟", "{{n}} more steps" / "{{n}} خطوات أخرى", "Step {{done}} of {{total}} done" / "تمّ {{done}} من {{total}} خطوات", "Saving..." / "جارٍ الحفظ...".
