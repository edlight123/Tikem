'use client'

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import { Search, Mail, MessageCircle, ChevronDown, ChevronUp, ExternalLink, Ticket, CalendarDays, FileText } from 'lucide-react'
import { EditorialSectionHeading } from '@/components/ui/EditorialHeader'
import { attendeeFAQCategoryMeta, organizerFAQCategoryMeta, type UserRole, type FAQCategory, type FAQItem } from './faqData'

/**
 * Surface pass on /support.
 *
 * Every card here was `bg-white/[0.03]` (or no fill at all) wrapped in
 * `border border-white/10`. On the #0a0a0a page a 3% fill is very nearly the
 * page colour, so the page read as a wireframe of outlined boxes — see
 * "Surfaces: a fill, not a hairline around nothing" in docs/POSH_DESIGN_BRIEF.md.
 * Cards now carry the fill; the contact cards sit INSIDE another card so they
 * step up the ladder (a 0.03 inside a 0.03 is invisible).
 *
 * The one border kept: `divide-y` between the FAQ rows of one accordion, where
 * the rule between rows IS the meaning.
 */

/** A card sitting directly on the page. */
const PAGE_CARD = 'rounded-xl bg-white/[0.03] p-6 transition-colors hover:bg-white/[0.07]'
/** A card sitting on another card — one step up the ladder. */
const NESTED_CARD = 'rounded-xl bg-white/[0.06] p-6 transition-colors hover:bg-white/[0.12]'

export default function SupportContent() {
  const { t } = useTranslation('support')
  const [role, setRole] = useState<UserRole>('attendee')
  const [searchQuery, setSearchQuery] = useState('')
  const [openFAQs, setOpenFAQs] = useState<Set<string>>(new Set())

  const categoryMeta = role === 'attendee' ? attendeeFAQCategoryMeta : organizerFAQCategoryMeta

  const currentFAQs: FAQCategory[] = useMemo(() => {
    return categoryMeta
      .map(({ id, icon }) => {
        const faqsRaw = t(`faq.${role}.categories.${id}.faqs`, { returnObjects: true })
        const faqs: FAQItem[] = Array.isArray(faqsRaw)
          ? (faqsRaw as FAQItem[]).filter((item) => Boolean(item?.question) && Boolean(item?.answer))
          : []

        return {
          id,
          icon,
          title: t(`faq.${role}.categories.${id}.title`),
          description: t(`faq.${role}.categories.${id}.description`),
          faqs
        }
      })
      .filter((category) => category.faqs.length > 0)
  }, [categoryMeta, role, t])

  // Filter FAQs based on search query
  const filteredFAQs = useMemo(() => {
    if (!searchQuery.trim()) return currentFAQs

    const query = searchQuery.toLowerCase()
    return currentFAQs
      .map((category) => ({
        ...category,
        faqs: category.faqs.filter(
          (faq) => faq.question.toLowerCase().includes(query) || faq.answer.toLowerCase().includes(query)
        )
      }))
      .filter((category) => category.faqs.length > 0)
  }, [currentFAQs, searchQuery])

  const toggleFAQ = (categoryId: string, faqIndex: number) => {
    const key = `${categoryId}-${faqIndex}`
    const newOpen = new Set(openFAQs)
    if (newOpen.has(key)) {
      newOpen.delete(key)
    } else {
      newOpen.add(key)
    }
    setOpenFAQs(newOpen)
  }

  const scrollToCategory = (categoryId: string) => {
    const element = document.getElementById(categoryId)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20">
          <div className="text-center max-w-3xl mx-auto">
            {/* Pill Label */}
            <div className="inline-flex items-center gap-2 px-3 py-1 backdrop-blur-sm rounded text-sm font-medium mb-4">
              <MessageCircle className="w-4 h-4 text-white/90" />
              <span>{t('hero.title')}</span>
            </div>

            {/* Title. `!` on the base size: body carries `.mobile-typography`,
                whose `h1 { @apply text-xl }` is an element+class selector (0,1,1)
                and beats a bare utility (0,1,0) — without it this hero collapsed
                to 20px on every phone. The sm:/lg: steps sit above that media
                query, so they need no override. */}
            <h1 className="!text-4xl !leading-[1.05] sm:text-5xl lg:text-6xl font-bold mb-4">
              {t('hero.title')}
            </h1>

            {/* Subtitle */}
            <p className="text-lg sm:text-xl text-brand-100 mb-8">
              {t('hero.subtitle')}
            </p>

            {/* Search Bar */}
            <div className="relative max-w-2xl mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
              <input
                type="text"
                placeholder={t('search.placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                // The field had `border-0` and no fill at all — a transparent
                // input with only a caret to say it was there. A field gets a
                // FILL; 16px keeps iOS from zooming the page on focus.
                className="w-full pl-12 pr-4 py-4 rounded-xl border-0 bg-white/15 text-[16px] text-white placeholder-white/60 focus:ring-2 focus:ring-inset focus:ring-white/70 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Role Toggle. The hairline under this sticky bar sat a few pixels below
          the navbar's own border and read as a crack across the page; the bar is
          opaque page colour, so the content scrolling under it is separation
          enough. `shadow-sm` was a black shadow on a black page. */}
      <div className="bg-[#0a0a0a] sticky top-14 sm:top-16 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-center gap-2">
            <button
              onClick={() => {
                setRole('attendee')
                setSearchQuery('')
                setOpenFAQs(new Set())
              }}
              // Chosen chip = the white pill, unchosen = the ladder's control
              // fill with a real hover step. Same correction as ui/kit's Chip:
              // teal is semantic in this app, never a surface.
              className={`px-6 py-2.5 rounded font-semibold transition-colors ${
                role === 'attendee'
                  ? 'bg-white text-black'
                  : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <Ticket className="w-4 h-4" />
                {t('role_toggle.attendee')}
              </span>
            </button>
            <button
              onClick={() => {
                setRole('organizer')
                setSearchQuery('')
                setOpenFAQs(new Set())
              }}
              className={`px-6 py-2.5 rounded font-semibold transition-colors ${
                role === 'organizer'
                  ? 'bg-white text-black'
                  : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="w-4 h-4" />
                {t('role_toggle.organizer')}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Top Help Topics Grid */}
        {!searchQuery && (
          <div className="mb-16">
            <EditorialSectionHeading
              className="mb-8"
              title={t('categories.title', 'Top Help Topics')}
              description={t('categories.subtitle', 'Browse by category or search for specific questions')}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {currentFAQs.map((category) => (
                <button
                  key={category.id}
                  onClick={() => scrollToCategory(category.id)}
                  className={`${PAGE_CARD} text-left group`}
                >
                  <div className="w-10 h-10 rounded-xl bg-white/[0.07] flex items-center justify-center mb-3">
                    <category.icon className="w-5 h-5 text-brand-300" />
                  </div>
                  <h3 className="font-semibold text-white mb-2">
                    {category.title}
                  </h3>
                  <p className="text-sm text-white/65">
                    {category.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* FAQ Sections */}
        <div className="space-y-12">
          {searchQuery && filteredFAQs.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.06] flex items-center justify-center">
                <Search className="w-7 h-7 text-white/50" />
              </div>
              {/* `!text-2xl`: `.mobile-typography h3` (0,1,1) was collapsing this
                  to 16px on every phone. */}
              <h3 className="font-display lowercase !text-2xl !leading-[1.04] text-white mb-2">
                {t('search.no_results')}
              </h3>
              <p className="text-white/65">
                {t('search.no_results_desc')}
              </p>
            </div>
          )}

          {filteredFAQs.map((category) => (
            <div key={category.id} id={category.id} className="scroll-mt-20">
              <div className="flex items-start gap-3 mb-6">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-white/[0.06] flex items-center justify-center">
                  <category.icon className="w-5 h-5 text-white/70" />
                </div>
                <EditorialSectionHeading
                  className="min-w-0 flex-1"
                  title={category.title}
                  description={category.description}
                />
              </div>

              {/* The `divide-y` stays: a rule BETWEEN the rows of one accordion
                  is the meaning. What went is the border drawn around the box. */}
              <div className="bg-white/[0.03] rounded-xl divide-y divide-white/10 overflow-hidden">
                {category.faqs.map((faq, index) => {
                  const key = `${category.id}-${index}`
                  const isOpen = openFAQs.has(key)

                  return (
                    <div key={index}>
                      <button
                        onClick={() => toggleFAQ(category.id, index)}
                        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-white/[0.07] transition-colors"
                      >
                        <span className="font-semibold text-white pr-4">
                          {faq.question}
                        </span>
                        {isOpen ? (
                          <ChevronUp className="w-5 h-5 text-white/50 flex-shrink-0" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-white/50 flex-shrink-0" />
                        )}
                      </button>
                      {isOpen && (
                        <div className="px-6 pb-4 text-white/70 leading-relaxed">
                          {faq.answer}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Still Need Help Section */}
        {/* Was a 2xl box outlined in white/10 with no fill behind it at all —
            the purest form of the defect. */}
        <div className="mt-20 rounded-2xl bg-white/[0.03] p-8 sm:p-12">
          <div className="max-w-2xl mb-8">
            <EditorialSectionHeading
              title={t('need_help.title')}
              description={t('need_help.description')}
            />
          </div>

          {/* These cards sit ON the card above, so they take the next rung of
              the ladder — a 0.03 inside a 0.03 is invisible. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl">
            {/* Email Support */}
            <a
              href="mailto:support@tikem.co"
              className={`${NESTED_CARD} group block`}
            >
              <div className="flex items-center justify-between mb-3">
                <Mail className="w-6 h-6 text-brand-300" />
                <ExternalLink className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" />
              </div>
              <h3 className="font-semibold text-white mb-1">{t('contact_cards.email_title')}</h3>
              <p className="text-sm text-white/65">
                {t('contact_cards.email_desc')}
              </p>
            </a>

            {/* WhatsApp */}
            <a
              href="https://wa.me/17542768676"
              target="_blank"
              rel="noopener noreferrer"
              className={`${NESTED_CARD} group block`}
            >
              <div className="flex items-center justify-between mb-3">
                {/* green-600 is a dark green on a black page — near unreadable. */}
                <MessageCircle className="w-6 h-6 text-green-400" />
                <ExternalLink className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" />
              </div>
              <h3 className="font-semibold text-white mb-1">{t('contact_cards.whatsapp_title')}</h3>
              <p className="text-sm text-white/65">
                {t('contact_cards.whatsapp_desc')}
              </p>
            </a>

            {/* Submit a Request */}
            <Link
              href="/support/request"
              className={`${NESTED_CARD} group block`}
            >
              <div className="flex items-center justify-between mb-3">
                <FileText className="w-6 h-6 text-brand-300" />
                <ExternalLink className="w-4 h-4 text-white/40 group-hover:text-white transition-colors" />
              </div>
              <h3 className="font-semibold text-white mb-1">{t('contact_cards.request_title')}</h3>
              <p className="text-sm text-white/65">
                {t('contact_cards.request_desc')}
              </p>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
