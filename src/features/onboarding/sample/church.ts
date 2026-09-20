/**
 * Church sample data: one week of visitor follow-up and community partnerships.
 *
 * Six partner organisations an office would actually work with — a food
 * bank, two schools, a shelter, a community nonprofit and a local radio
 * station — plus ten individuals and families moving from a first visit
 * through follow-up to joining, with one visitor who never came back. Two
 * follow-ups are already late.
 *
 * Most of these carry no money at all, and that is the point: a church is not
 * selling anything, so the only rows with a value on them are the two the
 * building genuinely charges for. The pipeline is there to stop a family who
 * visited once from being forgotten.
 *
 * Nothing here puts a religious or political statement in anyone's mouth
 * beyond the plainly practical. Every person, organisation and number is
 * invented.
 */
import type { SampleSet } from "./types";

export const sample: SampleSet = {
  trade: "church",

  companies: [
    {
      key: "co-harvest-food-bank",
      name: "Harvest Valley Food Bank",
      website: "harvestvalleyfoodbank.example",
      phone: "(801) 555-0101",
      notes: "Wants volunteers for the Saturday distribution every month.",
    },
    {
      key: "co-maple-street-school",
      name: "Maple Street Elementary",
      website: "maplestreetelementary.example",
      phone: "(801) 555-0102",
      notes: "Partners with us on the fall backpack drive.",
    },
    {
      key: "co-mercy-house",
      name: "Mercy House Shelter",
      website: "mercyhouseshelter.example",
      phone: "(801) 555-0103",
      notes: "Asked about a meal team for the third Thursday of the month.",
    },
    {
      key: "co-riverbend-christian-school",
      name: "Riverbend Christian Academy",
      website: "riverbendchristian.example",
      phone: "(801) 555-0104",
      notes: "Shares our building for weekday classes.",
    },
    {
      key: "co-hope-builders",
      name: "Hope Builders Nonprofit",
      website: "hopebuildersnonprofit.example",
      phone: "(801) 555-0105",
      notes: "Invited us to co-host a community clean-up day.",
    },
    {
      key: "co-valley-radio",
      name: "Valley Community Radio",
      phone: "(801) 555-0106",
      notes: "Broadcasts the Sunday service tape-delayed at 6pm.",
    },
  ],

  contacts: [
    {
      key: "ct-marlene-harvest",
      firstName: "Marlene",
      lastName: "Osgood",
      companyKey: "co-harvest-food-bank",
      email: "marlene@harvestvalleyfoodbank.example",
      phone: "(801) 555-0110",
    },
    {
      key: "ct-donovan-maple",
      firstName: "Donovan",
      lastName: "Achterberg",
      companyKey: "co-maple-street-school",
      email: "donovan@maplestreetelementary.example",
      phone: "(801) 555-0111",
    },
    {
      key: "ct-imelda-mercy",
      firstName: "Imelda",
      lastName: "Castellano",
      companyKey: "co-mercy-house",
      email: "imelda@mercyhouseshelter.example",
      phone: "(801) 555-0112",
    },
    {
      key: "ct-augustin-riverbend",
      firstName: "Augustin",
      lastName: "Vantwistan",
      companyKey: "co-riverbend-christian-school",
      email: "augustin@riverbendchristian.example",
      phone: "(801) 555-0113",
    },
    {
      key: "ct-priscilla-hopebuilders",
      firstName: "Priscilla",
      lastName: "Nkemelu",
      companyKey: "co-hope-builders",
      email: "priscilla@hopebuildersnonprofit.example",
      phone: "(801) 555-0114",
    },
    {
      key: "ct-desmond-radio",
      firstName: "Desmond",
      lastName: "Fairweather",
      companyKey: "co-valley-radio",
      email: "desmond@valleycommunityradio.example",
      phone: "(801) 555-0115",
    },
    {
      key: "ct-thornbury",
      firstName: "Hazel",
      lastName: "Thornbury",
      email: "hazel.thornbury@mailbox.example",
      phone: "(801) 555-0116",
      notes: "Visited last Sunday with her husband and two kids.",
    },
    {
      key: "ct-alderman",
      firstName: "Rowan",
      lastName: "Alderman",
      email: "rowan.alderman@mailbox.example",
      phone: "(801) 555-0117",
      notes: "Wants to know about small groups before committing to anything else.",
    },
    {
      key: "ct-castillo",
      firstName: "Marisol",
      lastName: "Castillo",
      email: "marisol.castillo@mailbox.example",
      phone: "(801) 555-0118",
    },
    {
      key: "ct-winslow",
      firstName: "Grady",
      lastName: "Winslow",
      email: "grady.winslow@mailbox.example",
      phone: "(801) 555-0119",
      notes: "Family coming from out of town for the ceremony.",
    },
    {
      key: "ct-park",
      firstName: "Soo-ah",
      lastName: "Park",
      email: "sooah.park@mailbox.example",
      phone: "(801) 555-0120",
    },
    {
      key: "ct-oduya",
      firstName: "Ifeoma",
      lastName: "Oduya",
      email: "ifeoma.oduya@mailbox.example",
      phone: "(801) 555-0121",
      fields: { "Best way to reach them": "Call" },
    },
    {
      key: "ct-fenwick",
      firstName: "Barnaby",
      lastName: "Fenwick",
      email: "barnaby.fenwick@mailbox.example",
      phone: "(801) 555-0122",
      notes: "Said he would come back after his first visit. Hasn't yet.",
    },
    {
      key: "ct-harborough",
      firstName: "Delphine",
      lastName: "Harborough",
      email: "delphine.harborough@mailbox.example",
      phone: "(801) 555-0123",
      notes: "Family of six, asked about overflow parking on Sundays.",
    },
    {
      key: "ct-quintrell",
      firstName: "Odalys",
      lastName: "Quintrell",
      email: "odalys.quintrell@mailbox.example",
      phone: "(801) 555-0124",
      notes: "Came through the young adults group before ever attending a service.",
    },
    {
      key: "ct-marsh",
      firstName: "Teodoro",
      lastName: "Marsh",
      email: "teodoro.marsh@mailbox.example",
      phone: "(801) 555-0125",
      fields: { "Best way to reach them": "Text" },
    },
  ],

  deals: [
    {
      key: "dl-thornbury",
      title: "Thornbury family, first visit follow-up",
      value: 0,
      stage: "Followed up",
      contactKey: "ct-thornbury",
      sourceName: "Walk-in",
      ageDays: 18,
      stageDays: 6,
      expectedInDays: 5,
      fields: { "Reason for visiting": "First time visitor" },
    },
    {
      key: "dl-alderman",
      title: "Alderman family, looking for a church home",
      value: 0,
      stage: "Visited a service",
      contactKey: "ct-alderman",
      sourceName: "Website",
      ageDays: 10,
      stageDays: 4,
      expectedInDays: 7,
      fields: { "Reason for visiting": "Looking for a church home" },
    },
    {
      key: "dl-castillo",
      title: "Castillo family, joined after new members class",
      value: 0,
      stage: "Joined the church",
      contactKey: "ct-castillo",
      sourceName: "Member invite",
      ageDays: 34,
      stageDays: 10,
      fields: { "Reason for visiting": "Looking for a church home" },
    },
    {
      key: "dl-winslow-baptism",
      title: "Winslow baptism inquiry",
      value: 400,
      stage: "Reached out",
      contactKey: "ct-winslow",
      sourceName: "Website",
      ageDays: 5,
      stageDays: 5,
      expectedInDays: 9,
      fields: { "Reason for visiting": "Baptism or wedding" },
      // $400: baptism preparation and the family reception is not one of the
      // two things the building charges a set fee for, so it is a custom line.
      items: [
        {
          name: "Baptism preparation and family reception",
          description: "Three prep sessions plus light refreshments after the service.",
          qty: 1,
          price: 400,
        },
      ],
    },
    {
      key: "dl-park-wedding",
      title: "Park family, chapel wedding inquiry",
      value: 900,
      stage: "New visit request",
      contactKey: "ct-park",
      sourceName: "Community event",
      ageDays: 1,
      stageDays: 1,
      expectedInDays: 14,
      fields: { "Reason for visiting": "Baptism or wedding" },
      // $750 wedding ceremony fee + 2 x $75 premarital counseling = $900,
      // which is what the two things this building actually charges for add up to.
      items: [
        { service: "Wedding ceremony fee", qty: 1 },
        {
          service: "Premarital counseling session",
          qty: 2,
          description: "Two sessions before the spring date they are asking about.",
        },
      ],
    },
    {
      key: "dl-oduya-prayer",
      title: "Oduya, asked for prayer support",
      value: 0,
      stage: "Followed up",
      contactKey: "ct-oduya",
      sourceName: "Walk-in",
      ageDays: 8,
      stageDays: 3,
      fields: { "Reason for visiting": "Prayer request" },
    },
    {
      key: "dl-fenwick-lost",
      title: "Fenwick, visited once",
      value: 0,
      stage: "Lost touch",
      contactKey: "ct-fenwick",
      sourceName: "Website",
      ageDays: 46,
      stageDays: 18,
      fields: { "Reason for visiting": "First time visitor" },
    },
    {
      key: "dl-harborough",
      title: "Harborough family, member invite",
      value: 0,
      stage: "Visited a service",
      contactKey: "ct-harborough",
      sourceName: "Member invite",
      ageDays: 7,
      stageDays: 3,
      expectedInDays: 10,
      fields: { "Reason for visiting": "First time visitor" },
    },
    {
      key: "dl-quintrell-joined",
      title: "Quintrell, joined after six months",
      value: 0,
      stage: "Joined the church",
      contactKey: "ct-quintrell",
      sourceName: "Community event",
      ageDays: 52,
      stageDays: 20,
      fields: { "Reason for visiting": "Looking for a church home" },
    },
    {
      key: "dl-marsh-prayer",
      title: "Marsh, asked for prayer during a move",
      value: 0,
      stage: "Reached out",
      contactKey: "ct-marsh",
      sourceName: "Walk-in",
      ageDays: 4,
      stageDays: 4,
      expectedInDays: 6,
      fields: { "Reason for visiting": "Prayer request" },
    },
  ],

  activities: [
    {
      kind: "call",
      body: "The Thornburys visited last Sunday and asked about the Wednesday kids programme.",
      daysAgo: 17,
      contactKey: "ct-thornbury",
      dealKey: "dl-thornbury",
    },
    {
      kind: "text",
      body: "Sent the Thornburys the sign-up link for kids classes.",
      daysAgo: 6,
      contactKey: "ct-thornbury",
      dealKey: "dl-thornbury",
    },
    {
      kind: "call",
      body: "The Aldermans want to know about small groups before committing to anything else.",
      daysAgo: 9,
      contactKey: "ct-alderman",
      dealKey: "dl-alderman",
    },
    {
      kind: "email",
      body: "Sent the Aldermans the small group schedule and a contact for the Tuesday night group.",
      daysAgo: 3,
      contactKey: "ct-alderman",
      dealKey: "dl-alderman",
    },
    {
      kind: "note",
      body: "The Castillo family came through a member invite and attended six weeks straight before deciding.",
      daysAgo: 33,
      contactKey: "ct-castillo",
      dealKey: "dl-castillo",
    },
    {
      kind: "call",
      body: "The Castillos signed the membership card after the new members class.",
      daysAgo: 10,
      contactKey: "ct-castillo",
      dealKey: "dl-castillo",
    },
    {
      kind: "email",
      body: "Sent Grady the baptism class dates, three Sundays before the ceremony.",
      daysAgo: 4,
      contactKey: "ct-winslow",
      dealKey: "dl-winslow-baptism",
    },
    {
      kind: "call",
      body: "Grady asked whether family from out of town can attend the class too.",
      daysAgo: 1,
      contactKey: "ct-winslow",
      dealKey: "dl-winslow-baptism",
    },
    {
      kind: "call",
      body: "The Park family asked about booking the chapel for a wedding in the spring.",
      daysAgo: 1,
      contactKey: "ct-park",
      dealKey: "dl-park-wedding",
    },
    {
      kind: "note",
      body: "Ifeoma asked for prayer during a job search.",
      daysAgo: 7,
      contactKey: "ct-oduya",
      dealKey: "dl-oduya-prayer",
    },
    {
      kind: "call",
      body: "Followed up with Ifeoma. Still interviewing, appreciated the check-in.",
      daysAgo: 2,
      contactKey: "ct-oduya",
      dealKey: "dl-oduya-prayer",
    },
    {
      kind: "note",
      body: "Barnaby visited once, said he would come back, never did.",
      daysAgo: 44,
      contactKey: "ct-fenwick",
      dealKey: "dl-fenwick-lost",
    },
    {
      kind: "call",
      body: "Left Barnaby a voicemail, no response since.",
      daysAgo: 20,
      contactKey: "ct-fenwick",
      dealKey: "dl-fenwick-lost",
    },
    {
      kind: "call",
      body: "The Harboroughs came on a member invite and asked about parking for a family of six.",
      daysAgo: 6,
      contactKey: "ct-harborough",
      dealKey: "dl-harborough",
    },
    {
      kind: "text",
      body: "Sent the Harboroughs the overflow parking map for Sunday.",
      daysAgo: 2,
      contactKey: "ct-harborough",
      dealKey: "dl-harborough",
    },
    {
      kind: "call",
      body: "Odalys started coming to the young adults group before ever attending a service.",
      daysAgo: 50,
      contactKey: "ct-quintrell",
      dealKey: "dl-quintrell-joined",
    },
    {
      kind: "note",
      body: "Odalys joined the church after months in the young adults group.",
      daysAgo: 15,
      contactKey: "ct-quintrell",
      dealKey: "dl-quintrell-joined",
    },
    {
      kind: "call",
      body: "Teodoro asked for prayer during a move across the state.",
      daysAgo: 3,
      contactKey: "ct-marsh",
      dealKey: "dl-marsh-prayer",
    },
    {
      kind: "note",
      body: "Harvest Valley wants volunteers for the Saturday distribution again this month.",
      daysAgo: 12,
      contactKey: "ct-marlene-harvest",
      companyKey: "co-harvest-food-bank",
    },
    {
      kind: "email",
      body: "Maple Street asked if we can donate backpacks again for the fall drive.",
      daysAgo: 19,
      contactKey: "ct-donovan-maple",
      companyKey: "co-maple-street-school",
    },
    {
      kind: "call",
      body: "Mercy House asked about a meal team for the third Thursday.",
      daysAgo: 25,
      contactKey: "ct-imelda-mercy",
      companyKey: "co-mercy-house",
    },
    {
      kind: "note",
      body: "Hope Builders invited us to co-host the community clean-up day.",
      daysAgo: 14,
      contactKey: "ct-priscilla-hopebuilders",
      companyKey: "co-hope-builders",
    },
  ],

  tasks: [
    {
      title: "Call the Aldermans back about the small group schedule",
      dueInDays: -3,
      contactKey: "ct-alderman",
      dealKey: "dl-alderman",
    },
    {
      title: "Follow up with Grady on the out-of-town guest question",
      dueInDays: -1,
      contactKey: "ct-winslow",
      dealKey: "dl-winslow-baptism",
    },
    {
      title: "Send the Park family a date for the spring wedding",
      dueInDays: 0,
      contactKey: "ct-park",
      dealKey: "dl-park-wedding",
    },
    {
      title: "Check in with Ifeoma on the job search",
      dueInDays: 2,
      contactKey: "ct-oduya",
      dealKey: "dl-oduya-prayer",
    },
    {
      title: "Send the Harboroughs a welcome card",
      dueInDays: 1,
      contactKey: "ct-harborough",
      dealKey: "dl-harborough",
    },
    {
      title: "Sign up volunteers for the Harvest Valley Saturday distribution",
      dueInDays: 4,
      contactKey: "ct-marlene-harvest",
    },
    {
      title: "Confirm the backpack donation count with Maple Street",
      dueInDays: 6,
      contactKey: "ct-donovan-maple",
    },
    {
      title: "Schedule the Mercy House meal team for the third Thursday",
      dueInDays: 8,
      contactKey: "ct-imelda-mercy",
    },
  ],

  /*
   * One paid invoice, which is the only deal in the set old enough and priced
   * enough to raise one. Neither "won" deal (Castillo, Quintrell) carries a
   * fee — a family joining the church is not billed for it — so unlike a
   * for-profit trade, this one has no plausible won-stage invoice, and there
   * is no deal here both priced and old enough to be worth chasing as an
   * overdue second invoice.
   */
  documents: [
    {
      kind: "invoice",
      dealKey: "dl-winslow-baptism",
      status: "paid",
      lines: "one_time",
      issuedDaysAgo: 4,
      dueInDays: 14,
      paidDaysAgo: 4,
      paidMethod: "card",
    },
  ],
};

export default sample;
