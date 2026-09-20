/**
 * CrossFit gym sample data: one week turning free-class signups into members.
 *
 * No company accounts here — every signup is a person walking in for
 * themselves, so a company row would only be noise. Sixteen people moving
 * from a first signup through the on-ramp to a sold membership, with one
 * free-class signup that never followed through. Two follow-ups are
 * already late.
 *
 * Every person and number here is invented.
 */
import type { SampleSet } from "./types";

export const sample: SampleSet = {
  trade: "crossfit-gym",

  companies: [],

  contacts: [
    {
      key: "ct-brantley",
      firstName: "Brantley",
      lastName: "Osei",
      email: "brantley.osei@mailbox.example",
      phone: "(801) 555-0110",
      fields: { "Fitness background": "Some experience" },
    },
    {
      key: "ct-fenella",
      firstName: "Fenella",
      lastName: "Marchetti",
      email: "fenella.marchetti@mailbox.example",
      phone: "(801) 555-0111",
      fields: { "Fitness background": "New to CrossFit" },
    },
    {
      key: "ct-dashiell",
      firstName: "Dashiell",
      lastName: "Kowalczyk",
      email: "dashiell.kowalczyk@mailbox.example",
      phone: "(801) 555-0112",
      notes: "Used to lift but never tried CrossFit style training.",
    },
    {
      key: "ct-marigold",
      firstName: "Marigold",
      lastName: "Achterberg",
      email: "marigold.achterberg@mailbox.example",
      phone: "(801) 555-0113",
      fields: { "Fitness background": "New to CrossFit" },
    },
    {
      key: "ct-thaddeus",
      firstName: "Thaddeus",
      lastName: "Ferreira",
      email: "thaddeus.ferreira@mailbox.example",
      phone: "(801) 555-0114",
    },
    {
      key: "ct-quintessa",
      firstName: "Quintessa",
      lastName: "Oyelaran",
      email: "quintessa.oyelaran@mailbox.example",
      phone: "(801) 555-0115",
      fields: { "Fitness background": "Some experience" },
    },
    {
      key: "ct-rutherford",
      firstName: "Rutherford",
      lastName: "Nakashima",
      email: "rutherford.nakashima@mailbox.example",
      phone: "(801) 555-0116",
      notes: "Signed up for a free class, never came back to book it.",
    },
    {
      key: "ct-linnea",
      firstName: "Linnea",
      lastName: "Castellano",
      email: "linnea.castellano@mailbox.example",
      phone: "(801) 555-0117",
    },
    {
      key: "ct-osmund",
      firstName: "Osmund",
      lastName: "Vantwistan",
      email: "osmund.vantwistan@mailbox.example",
      phone: "(801) 555-0118",
      fields: { "Fitness background": "New to CrossFit" },
    },
    {
      key: "ct-saoirse",
      firstName: "Saoirse",
      lastName: "Blackwood",
      email: "saoirse.blackwood@mailbox.example",
      phone: "(801) 555-0119",
    },
    {
      key: "ct-corwin",
      firstName: "Corwin",
      lastName: "Doyle",
      email: "corwin.doyle@mailbox.example",
      phone: "(801) 555-0120",
      fields: { "Fitness background": "Competitive athlete" },
    },
    {
      key: "ct-petra",
      firstName: "Petra",
      lastName: "Halloway",
      email: "petra.halloway@mailbox.example",
      phone: "(801) 555-0121",
      notes: "Asked about the schedule for a masters-age class.",
    },
    {
      key: "ct-emory",
      firstName: "Emory",
      lastName: "Farraday",
      email: "emory.farraday@mailbox.example",
      phone: "(801) 555-0122",
    },
    {
      key: "ct-guinevere",
      firstName: "Guinevere",
      lastName: "Standish",
      email: "guinevere.standish@mailbox.example",
      phone: "(801) 555-0123",
      notes: "Watched a class from the lobby before deciding to ask questions.",
    },
    {
      key: "ct-percival",
      firstName: "Percival",
      lastName: "Nkemelu",
      email: "percival.nkemelu@mailbox.example",
      phone: "(801) 555-0124",
    },
    {
      key: "ct-marlowe",
      firstName: "Marlowe",
      lastName: "Hensley",
      email: "marlowe.hensley@mailbox.example",
      phone: "(801) 555-0125",
      fields: { "Fitness background": "Competitive athlete" },
    },
  ],

  deals: [
    {
      key: "dl-brantley-unlimited",
      title: "Unlimited monthly membership",
      /*
       * $2,100, not $1,800: `value_cents` is the ANNUAL value — one-time plus
       * twelve months of any recurring line — and this deal now carries only
       * the $175/month unlimited membership line, so $0 + 12 x $175 = $2,100.
       * It is the only won deal priced this way, which is what lets
       * `invoiceSchedules.ensureForWonDeal` show a real MRR and ARR instead
       * of three empty reports (R9, requirement 1).
       */
      value: 2100,
      stage: "Membership sold",
      contactKey: "ct-brantley",
      sourceName: "Website",
      ageDays: 20,
      stageDays: 7,
      fields: { "Membership interest": "Unlimited monthly" },
      items: [{ service: "Monthly unlimited membership", qty: 1 }],
    },
    {
      key: "dl-fenella-onramp",
      title: "Six-session on-ramp",
      value: 240,
      stage: "On-ramp complete",
      contactKey: "ct-fenella",
      sourceName: "Instagram",
      ageDays: 8,
      stageDays: 3,
      fields: { "Membership interest": "On-ramp" },
    },
    {
      key: "dl-dashiell-dropin",
      title: "Drop-in class",
      value: 25,
      stage: "On-ramp booked",
      contactKey: "ct-dashiell",
      sourceName: "Walk-in",
      ageDays: 3,
      stageDays: 3,
      expectedInDays: 2,
      fields: { "Membership interest": "Drop-in" },
      // $25, straight off the catalogue.
      items: [{ service: "Drop-in class", qty: 1 }],
    },
    {
      key: "dl-marigold-notsure",
      title: "Free class, undecided on membership",
      value: 20,
      stage: "Reached out",
      contactKey: "ct-marigold",
      sourceName: "Website",
      ageDays: 5,
      stageDays: 5,
      expectedInDays: 4,
      fields: { "Membership interest": "Not sure yet" },
    },
    {
      key: "dl-thaddeus-unlimited",
      title: "Unlimited monthly membership",
      value: 1800,
      stage: "New signup",
      contactKey: "ct-thaddeus",
      sourceName: "Member referral",
      ageDays: 1,
      stageDays: 1,
      expectedInDays: 10,
      fields: { "Membership interest": "Unlimited monthly" },
    },
    {
      key: "dl-quintessa-onramp",
      title: "Six-session on-ramp",
      value: 240,
      stage: "Membership sold",
      contactKey: "ct-quintessa",
      sourceName: "Instagram",
      ageDays: 27,
      stageDays: 10,
      fields: { "Membership interest": "On-ramp" },
      // $240 flat: the six-session on-ramp is sold as one bundled package,
      // not per-session off the catalogue, so it is a custom line.
      items: [
        {
          name: "Six-session on-ramp package",
          description: "All six sessions completed before she signed.",
          qty: 1,
          price: 240,
        },
      ],
    },
    {
      key: "dl-rutherford-wentcold",
      title: "Free class signup",
      value: 20,
      stage: "Went cold",
      contactKey: "ct-rutherford",
      sourceName: "Website",
      ageDays: 45,
      stageDays: 17,
      fields: { "Membership interest": "Not sure yet" },
      // $20 flat for the free-class trial, never followed by a membership.
      items: [
        {
          name: "Free class visit",
          description: "Signed up for a free class, never came back to book it.",
          qty: 1,
          price: 20,
        },
      ],
    },
    {
      key: "dl-linnea-onrampcomplete",
      title: "Six-session on-ramp",
      value: 240,
      stage: "On-ramp complete",
      contactKey: "ct-linnea",
      sourceName: "Walk-in",
      ageDays: 10,
      stageDays: 4,
      fields: { "Membership interest": "On-ramp" },
    },
    {
      key: "dl-osmund-onrampbooked",
      title: "Six-session on-ramp",
      value: 240,
      stage: "On-ramp booked",
      contactKey: "ct-osmund",
      sourceName: "Member referral",
      ageDays: 6,
      stageDays: 3,
      expectedInDays: 6,
      fields: { "Membership interest": "On-ramp" },
    },
    {
      key: "dl-saoirse-unlimited-reached",
      title: "Unlimited monthly membership",
      value: 1800,
      stage: "Reached out",
      contactKey: "ct-saoirse",
      sourceName: "Website",
      ageDays: 4,
      stageDays: 4,
      expectedInDays: 8,
      fields: { "Membership interest": "Unlimited monthly" },
    },
  ],

  activities: [
    {
      kind: "call",
      body: "Brantley finished the on-ramp and signed up for unlimited the same day.",
      daysAgo: 19,
      contactKey: "ct-brantley",
      dealKey: "dl-brantley-unlimited",
    },
    {
      kind: "note",
      body: "Brantley asked about the competitive team once he settles into regular classes.",
      daysAgo: 12,
      contactKey: "ct-brantley",
      dealKey: "dl-brantley-unlimited",
    },
    {
      kind: "text",
      body: "Fenella finished her sixth on-ramp session, ready for regular class.",
      daysAgo: 7,
      contactKey: "ct-fenella",
      dealKey: "dl-fenella-onramp",
    },
    {
      kind: "call",
      body: "Dashiell has lifted before but wants a coach to check his form on the Olympic lifts.",
      daysAgo: 3,
      contactKey: "ct-dashiell",
      dealKey: "dl-dashiell-dropin",
    },
    {
      kind: "email",
      body: "Sent Marigold the free class confirmation, she is deciding on membership after.",
      daysAgo: 5,
      contactKey: "ct-marigold",
      dealKey: "dl-marigold-notsure",
    },
    {
      kind: "note",
      body: "Thaddeus signed up after his coworker showed him her workout videos.",
      daysAgo: 1,
      contactKey: "ct-thaddeus",
      dealKey: "dl-thaddeus-unlimited",
    },
    {
      kind: "call",
      body: "Quintessa finished the on-ramp, comfortable with the barbell movements now.",
      daysAgo: 26,
      contactKey: "ct-quintessa",
      dealKey: "dl-quintessa-onramp",
    },
    {
      kind: "note",
      body: "Quintessa signed the membership form after her last on-ramp session.",
      daysAgo: 17,
      contactKey: "ct-quintessa",
      dealKey: "dl-quintessa-onramp",
    },
    {
      kind: "call",
      body: "Left Rutherford a message about booking his free class, no response yet.",
      daysAgo: 40,
      contactKey: "ct-rutherford",
      dealKey: "dl-rutherford-wentcold",
    },
    {
      kind: "note",
      body: "Rutherford never called back to schedule the free class.",
      daysAgo: 22,
      contactKey: "ct-rutherford",
      dealKey: "dl-rutherford-wentcold",
    },
    {
      kind: "text",
      body: "Linnea completed the on-ramp and asked about the early morning class times.",
      daysAgo: 9,
      contactKey: "ct-linnea",
      dealKey: "dl-linnea-onrampcomplete",
    },
    {
      kind: "call",
      body: "Osmund booked his first on-ramp session for next Monday.",
      daysAgo: 5,
      contactKey: "ct-osmund",
      dealKey: "dl-osmund-onrampbooked",
    },
    {
      kind: "email",
      body: "Sent Saoirse the unlimited membership pricing and the current promotion.",
      daysAgo: 4,
      contactKey: "ct-saoirse",
      dealKey: "dl-saoirse-unlimited-reached",
    },
    {
      kind: "call",
      body: "Saoirse wants to try a couple more classes before committing to unlimited.",
      daysAgo: 1,
      contactKey: "ct-saoirse",
      dealKey: "dl-saoirse-unlimited-reached",
    },
    {
      kind: "note",
      body: "Corwin asked whether the gym runs a competitive team for local meets.",
      daysAgo: 13,
      contactKey: "ct-corwin",
    },
    {
      kind: "call",
      body: "Petra asked about the schedule for a masters-age class.",
      daysAgo: 10,
      contactKey: "ct-petra",
    },
    {
      kind: "text",
      body: "Emory asked whether the gym offers a punch card instead of a monthly plan.",
      daysAgo: 15,
      contactKey: "ct-emory",
    },
    {
      kind: "call",
      body: "Guinevere watched a class from the lobby before coming in to ask questions.",
      daysAgo: 6,
      contactKey: "ct-guinevere",
    },
    {
      kind: "note",
      body: "Percival asked how the on-ramp differs from just joining a regular class.",
      daysAgo: 11,
      contactKey: "ct-percival",
    },
    {
      kind: "call",
      body: "Marlowe, a former competitive athlete, asked about jumping straight into regular classes.",
      daysAgo: 8,
      contactKey: "ct-marlowe",
    },
  ],

  tasks: [
    {
      title: "Call Rutherford one more time before closing the file",
      dueInDays: -4,
      contactKey: "ct-rutherford",
      dealKey: "dl-rutherford-wentcold",
    },
    {
      title: "Follow up with Marigold on the membership decision",
      dueInDays: -2,
      contactKey: "ct-marigold",
      dealKey: "dl-marigold-notsure",
    },
    {
      title: "Confirm Osmund's first on-ramp session",
      dueInDays: 0,
      contactKey: "ct-osmund",
      dealKey: "dl-osmund-onrampbooked",
    },
    {
      title: "Check in with Saoirse after her extra classes",
      dueInDays: 2,
      contactKey: "ct-saoirse",
      dealKey: "dl-saoirse-unlimited-reached",
    },
    {
      title: "Send Thaddeus the new member welcome packet",
      dueInDays: 1,
      contactKey: "ct-thaddeus",
      dealKey: "dl-thaddeus-unlimited",
    },
    {
      title: "Send Petra the masters class schedule",
      dueInDays: 4,
      contactKey: "ct-petra",
    },
    {
      title: "Call Emory back about punch card options",
      dueInDays: 6,
      contactKey: "ct-emory",
    },
    {
      title: "Invite Marlowe to jump into a regular class this week",
      dueInDays: 3,
      contactKey: "ct-marlowe",
    },
  ],

  /*
   * One paid, one overdue: Collected has something to show, and the overdue
   * one gives the aging report a row. Both `one_time`, so Brantley's monthly
   * membership line is left to the billing schedule instead of being
   * invoiced twice.
   */
  documents: [
    {
      kind: "invoice",
      dealKey: "dl-quintessa-onramp",
      status: "paid",
      lines: "one_time",
      issuedDaysAgo: 8,
      dueInDays: 14,
      paidDaysAgo: 5,
      paidMethod: "card",
    },
    {
      /*
       * Issued 20 days ago on 14-day terms: six days over, same as the
       * landscaping example, on the one signup who never came back to book
       * the free class in the first place.
       */
      kind: "invoice",
      dealKey: "dl-rutherford-wentcold",
      status: "sent",
      lines: "one_time",
      issuedDaysAgo: 20,
      dueInDays: 14,
    },
  ],
};

export default sample;
