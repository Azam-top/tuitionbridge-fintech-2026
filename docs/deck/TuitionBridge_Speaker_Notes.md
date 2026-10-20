# TuitionBridge: speaker notes

About 9:00 in total (1042 words at a calm pace). Use short sentences and pause on the numbers. Everything on the slides is true today; if a fact changes, rebuild the deck (`npm run deck`) and re-read slides 5, 6 and 9.

## Slide 1: TuitionBridge
*0:00 to 0:30 (30 s)*

Hello. This is TuitionBridge. It helps an international student plan a tuition payment. It compares ways to pay, checks the deadline, and keeps the student's living money safe. In the next nine minutes I will show the problem, the product, how the AI and the server share the work, and what we have and have not proven.

## Slide 2: Paying tuition means balancing four things
*0:30 to 1:20 (50 s)*

Imagine a student who has dollars and a tuition invoice in tenge. They must think about four things at once. The amount. The full cost, because the rate and the fees change what they pay. The deadline, because the money must arrive in time, not only be sent. And their living money, because rent and food still need to be paid. Today these checks are done by hand. To be clear: this is our understanding of the problem. We have not interviewed students yet, and we do not show any statistics.

## Slide 3: TuitionBridge shows the full picture before you pay
*1:20 to 2:15 (55 s)*

TuitionBridge puts the answers in one place. First, the full cost: one total in dollars with the fee included. Second, timing: the expected arrival date next to the invoice deadline. Third, the reserve: the student chooses how much to keep for living costs, and every recommendation respects it. Fourth, a short reason for the recommendation, and the reasons other options were not chosen. These are the benefits we built for. We have not measured savings, and we do not claim any. The explanation matters because a student should be able to check the answer, not just trust it. If the student changes the goal or the reserve, the plan updates, and the numbers update with it.

## Slide 4: From invoice to payment
*2:15 to 3:05 (50 s)*

The journey has six steps. The student adds the invoice, by hand or from a text PDF, and checks every field. TuitionBridge then collects current options and compares them. The student reviews one clear plan. Step five is the important one: only the student can approve. Then the student continues on the provider's own site, here Wise, and completes the payment there. TuitionBridge does not move money. At any point the student can stop. Nothing is paid until they act at the provider, and the app never has access to the student's bank.

## Slide 5: The working product
*3:05 to 4:05 (60 s)*

This is the live product. Look at the three numbers. Number one: the student's funds, the living reserve, and how much is available for tuition. These numbers are entered by the student. The app does not read the bank. Number two: the transfer options, each with the total, the fee and the expected arrival. Number three: one recommendation with a short reason. Here it says the lowest total among three options that arrive by the deadline and keep the three hundred dollar reserve. This screenshot comes from the running app on the twentieth of October. The quotes are real Wise quotes. The assistant in this recording is a local test model, not a real AI model. Quotes change by the minute, so the numbers here differ a little from the next slide.

## Slide 6: One example: three ways to pay with Wise
*4:05 to 5:10 (65 s)*

Here is one documented example. The tuition is five hundred thousand tenge. The student has fifteen hundred dollars and keeps three hundred for living costs. These are three payment methods of one provider, Wise. The bank transfer has the lowest total, USD 1,126.80, and the lowest fee. The card options cost more but arrive earlier. Every option leaves the full reserve untouched. The quotes were taken on 20 October 2026, 12:13 UTC. They change by the minute and Wise does not guarantee them, so this is an example, not a promise. Look at the last column. After paying, the student still has at least three hundred dollars in every case, and the table shows how much more is left with the cheaper option.

## Slide 7: The AI explains. The server decides.
*5:10 to 6:05 (55 s)*

The AI has a clear, limited job. It reads what the student asks, for example lowest cost and keep three hundred dollars. It uses tools to read the invoice, the funds and the quotes. And it explains the result in plain words. The server does everything that involves money. It checks every amount, applies the deadline, the funds and the reserve, and ranks the options. The AI cannot approve a payment and cannot change an amount. If its text does not match the stored records, the app does not show it. This split is the main safety idea. A language model can make mistakes, so we never let it handle money directly. The numbers come from code that we test.

## Slide 8: Approval is tied to the exact plan
*6:05 to 7:05 (60 s)*

This is the review card. It shows the full recipient and account, the exact amounts, the deadline, the expected arrival and how long the offer is valid. When the student approves, the approval is tied to exactly these figures. If anything changes, a new plan needs a new approval. An expired offer cannot be approved, and the server checks it again at the end. After approval the student gets a payment instruction, and completes the payment at the provider. A mark or a file the student adds is only their own record. It is never presented as bank confirmation.

## Slide 9: Evidence and current limits
*7:05 to 8:15 (70 s)*

Here is what we measured, in three groups. Automated checks: 231 of 231 unit and integration tests pass, and 30 of 30 browser tests pass. The browser tests use a test model. Sandbox evaluation: 30 of 30 fixed cases pass, all 12 critical cases, and zero unauthorized payments. This uses test data and a stand-in AI, so it checks our server rules, not a real model. Real model runs: the first scripted run passed with a test student. The second failed because Wise rounds its displayed rate. We fixed that, but we have not re-run it on a real model. A manual pass with a real invoice is not done yet. So this is not a full live test. We do not claim bank certification or production readiness.

## Slide 10: Next steps
*8:15 to 9:00 (45 s)*

What comes next. First, a small pilot with students, to learn what really helps. Second, a check of demand with students and universities. Third, we finish the real-model checks: a manual pass with a real invoice, and the live evaluation. Fourth, we plan to add a second AI option, Gemini. That is only a plan. It is not built or tested. Our goal is simple: before any student pays, they see the full cost, the arrival date and a safe reserve. Thank you.

## If you are asked
- **Did you test with students?** No. The problem statement is our understanding. We have run no interviews yet.
- **Does it move money?** No. It prepares a plan and a payment instruction. The student completes the payment at the provider.
- **Is the AI safe to trust?** The AI cannot approve a payment or change an amount. The server checks the money, the deadline and the reserve.
- **Did a real AI model pass?** One scripted run passed on an older version and one failed because of Wise rounding. That is fixed, but not re-run on a real model. A manual pass with a real invoice is not done yet.
- **Is it bank-certified or ready for production?** No.
- **Gemini?** A planned second AI option. Not built or tested.
