// Which updates are about other groups than the viewer's. A student sees their own groups' news; the owner (the degree
// committee) follows the cohort's groups – the lines the faculty offered (committee.js). Shared by the updates page
// (which hides those items) and the unread badge (which must not count what the page hides).
import { forOtherGroups, lessonInCohort } from '../../../shared/groups.js';

export function otherGroupsTest({ courses, owner, cohort, classGroups }) {
  const courseOf = (id) => courses.find((c) => c.id === id);
  const groupsOf = (courseId) => (owner ? cohort?.[courseId] : classGroups?.[courseId]);
  return (i) => (
    (i.type === 'announcement' && forOtherGroups(`${i.title}\n${i.body || ''}`, courseOf(i.courseId), groupsOf(i.courseId), i.analysis))
    // A catalog change to another group's room or time (when the groups of that kind are known).
    || (i.type === 'class-change' && (owner ? !!cohort : true) && (() => { const mine = groupsOf(i.courseId)?.[i.classType]; return !!mine && ![].concat(mine).includes(i.group); })())
    // Another student's lesson (the owner's feed also carries those): not the cohort's.
    || (i.type === 'portal' && owner && !!cohort && !lessonInCohort({ name: i.lesson, type: i.lessonType, day: i.lessonDay, start: i.lessonStart }, courses, cohort))
  );
}
